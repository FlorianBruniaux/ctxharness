import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve, join, basename } from 'node:path'
import { load } from 'js-yaml'
import type { ScannerName } from '../config.js'

// ─── Public types ────────────────────────────────────────────────────────────

export type ScanResult = {
  file: string     // absolute path
  line: number     // 1-indexed (0 if no position available)
  actual: string   // what was found in the doc
  expected: string // what the extractor said
  status: 'pass' | 'fail' | 'skip' | 'warn'
  note?: string
}

export type ScannerFn = (
  filePath: string,
  expected: string,
  args: Record<string, unknown>,
) => ScanResult[]

// Re-export so consumers don't need to import config separately
export type { ScannerName }

// ─── Version normalization ───────────────────────────────────────────────────

/**
 * Partial-version comparison: compare only the segments the `actual` provides.
 *
 * Examples:
 *   normalizeMatch("14",     "14.2.0") → true   (actual only has major)
 *   normalizeMatch("14.2",   "14.2.0") → true   (actual has major.minor)
 *   normalizeMatch("14.3",   "14.2.0") → false  (14.3 ≠ 14.2)
 *   normalizeMatch("14.2.0", "14.2.0") → true   (exact match)
 */
export function normalizeMatch(actual: string, expected: string): boolean {
  // Strip leading "v" from both sides
  const a = actual.replace(/^v/i, '')
  const e = expected.replace(/^v/i, '')

  if (a === e) return true

  const aParts = a.split('.')
  const eParts = e.split('.')

  for (let i = 0; i < aParts.length; i++) {
    const ap = aParts[i]
    const ep = eParts[i]
    if (ap === undefined || ep === undefined) return false
    if (ap !== ep) return false
  }

  return true
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readLines(filePath: string): string[] {
  return readFileSync(filePath, 'utf-8').split('\n')
}

function dotGet(obj: unknown, path: string): string | undefined {
  const parts = path.split('.')
  let cur: unknown = obj
  for (const part of parts) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return typeof cur === 'string' ? cur : cur !== undefined && cur !== null ? String(cur) : undefined
}

// ─── 1. inlineRegex ──────────────────────────────────────────────────────────

/**
 * Scans every line of the file with a regex.
 * Args: { pattern: string, flags?: string }
 * Capture group 1 is the `actual` value; normalizeMatch determines status.
 */
function inlineRegex(filePath: string, expected: string, args: Record<string, unknown>): ScanResult[] {
  const pattern = args['pattern']
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new Error('inlineRegex scanner requires args.pattern (string)')
  }

  const flags = typeof args['flags'] === 'string' ? args['flags'] : 'gi'
  const lines = readLines(filePath)
  const results: ScanResult[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue

    const regex = new RegExp(pattern, flags)
    let match: RegExpExecArray | null

    while ((match = regex.exec(line)) !== null) {
      const actual = match[1] ?? match[0]
      results.push({
        file: filePath,
        line: i + 1,
        actual,
        expected,
        status: normalizeMatch(actual, expected) ? 'pass' : 'fail',
      })

      // Prevent infinite loop on zero-width matches
      if (match.index === regex.lastIndex) {
        regex.lastIndex++
      }
    }
  }

  return results
}

// ─── 2. codeBlockRegex ───────────────────────────────────────────────────────

/**
 * Same as inlineRegex but restricted to fenced code block content.
 * Args: { pattern: string, lang?: string, flags?: string }
 */
function codeBlockRegex(filePath: string, expected: string, args: Record<string, unknown>): ScanResult[] {
  const pattern = args['pattern']
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new Error('codeBlockRegex scanner requires args.pattern (string)')
  }

  const lang = typeof args['lang'] === 'string' ? args['lang'] : undefined
  const flags = typeof args['flags'] === 'string' ? args['flags'] : 'gi'
  const lines = readLines(filePath)
  const results: ScanResult[] = []

  let insideBlock = false
  let blockLang: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue

    const fenceMatch = /^```(\w*)/.exec(line)

    if (!insideBlock) {
      if (fenceMatch !== null) {
        insideBlock = true
        blockLang = fenceMatch[1] ?? ''
      }
      continue
    }

    // Closing fence
    if (line.trimStart().startsWith('```')) {
      insideBlock = false
      blockLang = null
      continue
    }

    // Skip if lang filter is set and doesn't match
    if (lang !== undefined && blockLang !== lang) continue

    const regex = new RegExp(pattern, flags)
    let match: RegExpExecArray | null

    while ((match = regex.exec(line)) !== null) {
      const actual = match[1] ?? match[0]
      results.push({
        file: filePath,
        line: i + 1,
        actual,
        expected,
        status: normalizeMatch(actual, expected) ? 'pass' : 'fail',
      })

      if (match.index === regex.lastIndex) {
        regex.lastIndex++
      }
    }
  }

  return results
}

// ─── 3. yamlField ────────────────────────────────────────────────────────────

/**
 * Parses YAML front matter (between leading --- delimiters) or the entire file as YAML.
 * Args: { field: string }  — dot-path to the field (e.g. "engines.node")
 */
function yamlField(filePath: string, expected: string, args: Record<string, unknown>): ScanResult[] {
  const field = args['field']
  if (typeof field !== 'string' || field.length === 0) {
    throw new Error('yamlField scanner requires args.field (string)')
  }

  const content = readFileSync(filePath, 'utf-8')

  // Try to extract YAML front matter first (--- ... ---)
  let yamlText = content
  let frontMatterLine = 1

  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (fmMatch !== null) {
    yamlText = fmMatch[1] ?? ''
    frontMatterLine = 1
  }

  let parsed: unknown
  try {
    parsed = load(yamlText)
  } catch {
    return []
  }

  const actual = dotGet(parsed, field)
  if (actual === undefined) return []

  return [
    {
      file: filePath,
      line: frontMatterLine,
      actual,
      expected,
      status: actual === expected ? 'pass' : 'fail',
    },
  ]
}

// ─── 4. jsonField ────────────────────────────────────────────────────────────

/**
 * Finds JSON objects in the file and navigates to a field via dot-path.
 * Args: { field: string }
 * Returns one ScanResult per valid JSON block that contains the field.
 */
function jsonField(filePath: string, expected: string, args: Record<string, unknown>): ScanResult[] {
  const field = args['field']
  if (typeof field !== 'string' || field.length === 0) {
    throw new Error('jsonField scanner requires args.field (string)')
  }

  const lines = readLines(filePath)
  const results: ScanResult[] = []

  // Heuristic: collect contiguous lines that form JSON objects
  // Strategy: scan for lines containing '{' and try to parse accumulating blocks
  let depth = 0
  let blockStart = -1
  let blockLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue

    for (const ch of line) {
      if (ch === '{') {
        if (depth === 0) {
          blockStart = i + 1
          blockLines = []
        }
        depth++
      } else if (ch === '}') {
        depth--
      }
    }

    if (blockStart > 0) {
      blockLines.push(line)
    }

    if (depth === 0 && blockStart > 0) {
      // Attempt to parse the accumulated block
      const jsonText = blockLines.join('\n')
      try {
        const parsed: unknown = JSON.parse(jsonText)
        const actual = dotGet(parsed, field)
        if (actual !== undefined) {
          results.push({
            file: filePath,
            line: blockStart,
            actual,
            expected,
            status: actual === expected ? 'pass' : 'fail',
          })
        }
      } catch {
        // Not valid JSON — skip
      }
      blockStart = -1
      blockLines = []
    }
  }

  return results
}

// ─── 5. literalInMd ──────────────────────────────────────────────────────────

/**
 * Checks if a literal string appears anywhere in the file (case-sensitive).
 * Args: { literal: string }
 * Returns exactly one ScanResult.
 */
function literalInMd(filePath: string, _expected: string, args: Record<string, unknown>): ScanResult[] {
  const literal = args['literal']
  if (typeof literal !== 'string' || literal.length === 0) {
    throw new Error('literalInMd scanner requires args.literal (string)')
  }

  const lines = readLines(filePath)
  let firstLine = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line !== undefined && line.includes(literal)) {
      firstLine = i + 1
      break
    }
  }

  const found = firstLine > 0

  return [
    {
      file: filePath,
      line: firstLine,
      actual: found ? literal : '',
      expected: literal,
      status: found ? 'pass' : 'fail',
    },
  ]
}

// ─── 6. pathReference ────────────────────────────────────────────────────────

/**
 * Checks if a path string appears anywhere in the doc as a substring.
 * Args: { path: string }
 * Returns exactly one ScanResult.
 */
function pathReference(filePath: string, _expected: string, args: Record<string, unknown>): ScanResult[] {
  const path = args['path']
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('pathReference scanner requires args.path (string)')
  }

  const lines = readLines(filePath)
  let firstLine = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line !== undefined && line.includes(path)) {
      firstLine = i + 1
      break
    }
  }

  const found = firstLine > 0

  return [
    {
      file: filePath,
      line: firstLine,
      actual: found ? path : '',
      expected: path,
      status: found ? 'pass' : 'fail',
    },
  ]
}

// ─── 7. vaguenessPattern ─────────────────────────────────────────────────────

/**
 * Detects vague language that reduces instruction quality for AI agents.
 * Flags phrases like "be careful", "as needed", "use your judgment", etc.
 * Args: { patterns?: string[] }  — optional extra regex patterns to detect
 *
 * Returns one fail result per vague phrase found, or a single pass result
 * if the file contains none. The `expected` param is ignored.
 */
const DEFAULT_VAGUE_PATTERNS: RegExp[] = [
  /\bbe careful\b/i,
  /\bas needed\b/i,
  /\bwhen necessary\b/i,
  /\buse your judgment\b/i,
  /\bappropriately\b/i,
  /\byou should know\b/i,
  /\bbe smart\b/i,
  /\bas appropriate\b/i,
  /\buse common sense\b/i,
  /\bif applicable\b/i,
]

function vaguenessPattern(
  filePath: string,
  _expected: string,
  args: Record<string, unknown>,
): ScanResult[] {
  const extraPatterns = (args['patterns'] as string[] | undefined) ?? []
  const allPatterns = [
    ...DEFAULT_VAGUE_PATTERNS,
    ...extraPatterns.map((p) => new RegExp(p, 'i')),
  ]

  const lines = readLines(filePath)
  const results: ScanResult[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue

    for (const pattern of allPatterns) {
      const match = line.match(pattern)
      if (match !== null) {
        results.push({
          file: filePath,
          line: i + 1,
          actual: match[0] ?? '',
          expected: '(no vague language)',
          status: 'fail',
        })
        break // one result per line max
      }
    }
  }

  if (results.length === 0) {
    results.push({
      file: filePath,
      line: 0,
      actual: '(none)',
      expected: '(no vague language)',
      status: 'pass',
    })
  }

  return results
}

// ─── 8. negativeConstraintDensity ────────────────────────────────────────────

/**
 * Checks that the positive:negative instruction ratio meets a minimum threshold.
 * A healthy instruction file has at least 2 positives per negative.
 * Args: { minRatio?: number }  — minimum positive:negative ratio (default 1.0)
 *
 * Positive keywords: always, prefer, use, should, must, recommended, do this
 * Negative keywords: never, do not, don't, avoid, prohibited, forbidden, not allowed
 *
 * Returns one result. The `expected` param is ignored; threshold comes from args.
 */
const POSITIVE_RE = /\b(always|prefer|use|should|must|recommended|do this)\b/gi
const NEGATIVE_RE = /\b(never|do not|don't|dont|avoid|prohibited|forbidden|not allowed)\b/gi

function negativeConstraintDensity(
  filePath: string,
  _expected: string,
  args: Record<string, unknown>,
): ScanResult[] {
  const minRatio = typeof args['minRatio'] === 'number' ? args['minRatio'] : 1.0

  const content = readFileSync(filePath, 'utf-8')
  const positiveCount = (content.match(POSITIVE_RE) ?? []).length
  const negativeCount = (content.match(NEGATIVE_RE) ?? []).length

  const ratio = negativeCount === 0 ? Infinity : positiveCount / negativeCount
  const ratioLabel =
    negativeCount === 0
      ? `∞ (${positiveCount}p / 0n)`
      : `${ratio.toFixed(1)} (${positiveCount}p / ${negativeCount}n)`

  return [
    {
      file: filePath,
      line: 0,
      actual: ratioLabel,
      expected: `≥${minRatio} positive/negative ratio`,
      status: ratio >= minRatio ? 'pass' : 'fail',
    },
  ]
}

// ─── 9. contextBudget ────────────────────────────────────────────────────────

/**
 * Measures a file's token footprint and fails if it exceeds a threshold.
 * Designed to be run over .claude/rules/**\/*.md or CLAUDE.md to catch bloated
 * context files before they degrade agent quality.
 *
 * Args:
 *   maxTokens?: number    — threshold in tokens (default 3000)
 *   followImports?: boolean — follow @file.md references and include their sizes
 *                             (resolves up to depth 3, relative to the scanned file)
 *
 * Token estimate: chars ÷ 4 (conservative average for English/code mix).
 * Returns one result.
 */
function collectChars(filePath: string, visited: Set<string>, depth: number): number {
  if (depth <= 0 || visited.has(filePath) || !existsSync(filePath)) return 0
  visited.add(filePath)

  const content = readFileSync(filePath, 'utf-8')
  let total = content.length

  const dir = dirname(filePath)
  const importPattern = /@([\w./\-]+\.md)/g
  let match: RegExpExecArray | null
  while ((match = importPattern.exec(content)) !== null) {
    const imported = resolve(dir, match[1]!)
    total += collectChars(imported, visited, depth - 1)
  }

  return total
}

function contextBudget(
  filePath: string,
  _expected: string,
  args: Record<string, unknown>,
): ScanResult[] {
  const maxTokens = typeof args['maxTokens'] === 'number' ? args['maxTokens'] : 3000
  const followImports = args['followImports'] === true

  const totalChars = followImports
    ? collectChars(filePath, new Set(), 3)
    : readFileSync(filePath, 'utf-8').length

  const estimatedTokens = Math.ceil(totalChars / 4)
  const suffix = followImports ? ' (incl. imports)' : ''

  return [
    {
      file: filePath,
      line: 0,
      actual: `${estimatedTokens} tokens${suffix}`,
      expected: `≤${maxTokens} tokens`,
      status: estimatedTokens <= maxTokens ? 'pass' : 'fail',
    },
  ]
}

// ─── 10. ruleGlobValidity ────────────────────────────────────────────────────

/**
 * Validates that a Claude Code rules file has proper YAML frontmatter.
 * Optionally enforces the presence of a `paths:` field for contextual loading.
 *
 * Args: { requirePaths?: boolean }
 *   - false (default): pass if the file has any YAML frontmatter
 *   - true: pass only if frontmatter includes a `paths:` field
 *
 * A rule file without frontmatter loads at every session regardless of context
 * (always-on), which is often unintentional overhead.
 */
function ruleGlobValidity(
  filePath: string,
  _expected: string,
  args: Record<string, unknown>,
): ScanResult[] {
  const requirePaths = args['requirePaths'] === true
  const content = readFileSync(filePath, 'utf-8')
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)

  if (frontmatterMatch === null) {
    return [
      {
        file: filePath,
        line: 0,
        actual: 'no frontmatter',
        expected: requirePaths ? 'YAML frontmatter with paths: field' : 'YAML frontmatter',
        status: 'fail',
      },
    ]
  }

  if (requirePaths) {
    const hasPaths = /^paths:/m.test(frontmatterMatch[1] ?? '')
    return [
      {
        file: filePath,
        line: 0,
        actual: hasPaths ? 'has paths:' : 'frontmatter present, no paths: field (always-on)',
        expected: 'YAML frontmatter with paths: field',
        status: hasPaths ? 'pass' : 'fail',
      },
    ]
  }

  return [
    {
      file: filePath,
      line: 0,
      actual: 'has frontmatter',
      expected: 'YAML frontmatter',
      status: 'pass',
    },
  ]
}

// ─── 11. hookValidity ────────────────────────────────────────────────────────

/**
 * STANDALONE scanner — receives root (not a file path).
 * Resolves .claude/settings.json from root and validates its hook entries.
 * Each hook group entry must have a non-empty `matcher` and a non-empty `hooks` array.
 * Each hook item must have `type` and `command` fields.
 */
function hookValidity(
  root: string,
  _expected: string,
  _args: Record<string, unknown>,
): ScanResult[] {
  const settingsPath = resolve(root, '.claude', 'settings.json')

  if (!existsSync(settingsPath)) {
    return [{ file: settingsPath, line: 0, actual: '.claude/settings.json not found', expected: 'valid hooks', status: 'skip' }]
  }

  const content = readFileSync(settingsPath, 'utf-8')

  let settings: unknown
  try {
    settings = JSON.parse(content)
  } catch {
    return [{ file: settingsPath, line: 0, actual: 'invalid JSON', expected: 'valid JSON', status: 'fail' }]
  }

  const hooks = (settings as Record<string, unknown>)['hooks']
  if (hooks === undefined || hooks === null || typeof hooks !== 'object') {
    return [{ file: settingsPath, line: 0, actual: 'no hooks defined', expected: 'valid hooks', status: 'pass' }]
  }

  const results: ScanResult[] = []

  for (const [eventType, entries] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (typeof entry !== 'object' || entry === null) continue

      const e = entry as Record<string, unknown>
      const matcher = e['matcher']
      const cmds = e['hooks']

      // matcher is optional — absent or empty string means "match all" (always-on hook)
      if (matcher !== undefined && typeof matcher !== 'string') {
        results.push({
          file: settingsPath,
          line: 0,
          actual: `${eventType}[${i}].matcher is not a string`,
          expected: 'string or absent matcher',
          status: 'fail',
        })
      }

      if (!Array.isArray(cmds) || cmds.length === 0) {
        results.push({
          file: settingsPath,
          line: 0,
          actual: `${eventType}[${i}].hooks is empty or missing`,
          expected: 'non-empty hooks array',
          status: 'fail',
        })
      } else {
        for (let j = 0; j < cmds.length; j++) {
          const cmd = cmds[j]
          if (typeof cmd !== 'object' || cmd === null) continue
          const c = cmd as Record<string, unknown>
          if (typeof c['type'] !== 'string' || c['type'].length === 0) {
            results.push({
              file: settingsPath,
              line: 0,
              actual: `${eventType}[${i}].hooks[${j}].type is missing`,
              expected: 'hook type string',
              status: 'fail',
            })
          }
          if (c['type'] === 'command' && (typeof c['command'] !== 'string' || (c['command'] as string).length === 0)) {
            results.push({
              file: settingsPath,
              line: 0,
              actual: `${eventType}[${i}].hooks[${j}].command is empty or missing`,
              expected: 'non-empty command string',
              status: 'fail',
            })
          }
          // Warn on absolute paths in hook commands — breaks on other machines
          if (c['type'] === 'command' && typeof c['command'] === 'string') {
            const cmd = c['command'] as string
            const absMatch = cmd.match(/(?:^|\s)(\/(?:Users|home|root|opt|var|srv)\/\S+)/)
            if (absMatch) {
              results.push({
                file: settingsPath,
                line: 0,
                actual: `${eventType}[${i}].hooks[${j}].command contains absolute path: ${absMatch[1]}`,
                expected: 'relative path (portability)',
                status: 'warn',
              })
            }
          }
        }
      }
    }
  }

  if (results.length === 0) {
    const hookCount = Object.keys(hooks as Record<string, unknown>).length
    results.push({
      file: settingsPath,
      line: 0,
      actual: `${hookCount} hook event type(s) valid`,
      expected: 'valid hooks',
      status: 'pass',
    })
  }

  return results
}

// ─── 12. backtickEntityPresence ──────────────────────────────────────────────

/**
 * Checks that a named entity appears as an inline code token (`entity`) in the doc.
 * Useful for verifying that function names, model names, or config keys are referenced
 * with proper code formatting rather than as plain text.
 *
 * Args: { entity: string }
 * Returns one result.
 */
function backtickEntityPresence(
  filePath: string,
  _expected: string,
  args: Record<string, unknown>,
): ScanResult[] {
  const entity = args['entity']
  if (typeof entity !== 'string' || entity.length === 0) {
    throw new Error('backtickEntityPresence scanner requires args.entity (string)')
  }

  const target = `\`${entity}\``
  const lines = readLines(filePath)
  let firstLine = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line !== undefined && line.includes(target)) {
      firstLine = i + 1
      break
    }
  }

  const found = firstLine > 0

  return [
    {
      file: filePath,
      line: firstLine,
      actual: found ? target : '',
      expected: target,
      status: found ? 'pass' : 'fail',
    },
  ]
}

// ─── 13. skillValidity ───────────────────────────────────────────────────────

function findMdFilesRecursive(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findMdFilesRecursive(fullPath))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath)
    }
  }
  return results
}

function validateOneSkillFile(
  filePath: string,
  requireDescription: boolean,
): ScanResult {
  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    return { file: filePath, line: 0, actual: 'unreadable', expected: 'valid skill frontmatter', status: 'fail' }
  }

  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (fmMatch === null) {
    return { file: filePath, line: 0, actual: 'no frontmatter', expected: 'YAML frontmatter with name: field', status: 'fail' }
  }

  const fm = fmMatch[1] ?? ''
  if (!/^name:/m.test(fm)) {
    return { file: filePath, line: 0, actual: 'frontmatter missing name:', expected: 'name: field required', status: 'fail' }
  }
  if (requireDescription && !/^description:/m.test(fm)) {
    return { file: filePath, line: 0, actual: 'frontmatter missing description:', expected: 'description: field required', status: 'fail' }
  }

  return { file: filePath, line: 0, actual: requireDescription ? 'has name: and description:' : 'has name:', expected: 'valid skill frontmatter', status: 'pass' }
}

/**
 * STANDALONE scanner — receives root (not a file path).
 * Globs all .md files under .claude/skills/ from root and validates each one.
 * Args: { requireDescription?: boolean }  — default true
 */
function skillValidity(
  root: string,
  _expected: string,
  args: Record<string, unknown>,
): ScanResult[] {
  const requireDescription = args['requireDescription'] !== false
  const skillsDir = resolve(root, '.claude', 'skills')

  if (!existsSync(skillsDir) || !statSync(skillsDir).isDirectory()) {
    return [{ file: skillsDir, line: 0, actual: 'no .claude/skills directory', expected: 'valid skill frontmatter', status: 'skip' }]
  }

  const entryPointOnly = args['entryPointOnly'] === true
  let mdFiles = findMdFilesRecursive(skillsDir)
  if (entryPointOnly) {
    mdFiles = mdFiles.filter((f) => basename(f) === 'skill.md')
  }
  if (mdFiles.length === 0) {
    return [{ file: skillsDir, line: 0, actual: 'no .md files in .claude/skills', expected: 'valid skill frontmatter', status: 'skip' }]
  }

  return mdFiles.map((f) => validateOneSkillFile(f, requireDescription))
}

// ─── 14. freshnessScore ──────────────────────────────────────────────────────

/**
 * STANDALONE scanner — receives root (not a file path).
 * Interprets the expected value (from gitStaleness extractor) as a commit count.
 * The source file path is passed via args._sourceFile (injected by runner from extractorArgs.path).
 * Args:
 *   warnAfter?: number   — commits after which to warn (default 30)
 *   failAfter?: number   — commits after which to fail (default 100)
 *   _sourceFile?: string — injected by runner for display purposes
 */
function freshnessScore(
  root: string,
  expected: string,
  args: Record<string, unknown>,
): ScanResult[] {
  const warnAfter = typeof args['warnAfter'] === 'number' ? args['warnAfter'] : 30
  const failAfter = typeof args['failAfter'] === 'number' ? args['failAfter'] : 100
  const sourceFile = typeof args['_sourceFile'] === 'string' ? args['_sourceFile'] : root

  if (args['generated'] === true) {
    return [
      {
        file: sourceFile,
        line: 0,
        actual: 'generated file — skipped',
        expected: `≤${warnAfter} (warn after), ≤${failAfter} (fail after)`,
        status: 'skip',
      },
    ]
  }

  const commits = parseInt(expected, 10)
  if (isNaN(commits)) {
    throw new Error(`freshnessScore: expected must be a numeric commit count string, got "${expected}"`)
  }

  let status: ScanResult['status']
  if (commits <= warnAfter) {
    status = 'pass'
  } else if (commits <= failAfter) {
    status = 'warn'
  } else {
    status = 'fail'
  }

  return [
    {
      file: sourceFile,
      line: 0,
      actual: `${commits} commits since last edit`,
      expected: `≤${warnAfter} (warn after), ≤${failAfter} (fail after)`,
      status,
    },
  ]
}

// ─── 15. coverageRatio ───────────────────────────────────────────────────────

/**
 * Checks what fraction of items in a JSON array (from prismaModelList/trpcRouterList)
 * appear in the file content.
 * Args:
 *   minRatio?: number          — minimum fraction required (default 0.8)
 *   valueAllowlist?: string[]  — entity names to skip before computing ratio
 * expected = JSON array string (e.g. '["User","Skill","UserSkill"]')
 * Returns ONE ScanResult.
 */
function coverageRatio(
  filePath: string,
  expected: string,
  args: Record<string, unknown>,
): ScanResult[] {
  const minRatio = typeof args['minRatio'] === 'number' ? args['minRatio'] : 0.8
  const argAllowlist = (args['valueAllowlist'] as string[] | undefined) ?? []

  let items: string[]
  try {
    const parsed: unknown = JSON.parse(expected)
    if (!Array.isArray(parsed) || parsed.some((x) => typeof x !== 'string')) {
      throw new Error('not a string array')
    }
    items = parsed as string[]
  } catch {
    throw new Error(`coverageRatio: expected must be a JSON string array, got "${expected}"`)
  }

  // Filter out allowlisted items
  const filtered = items.filter((item) => !argAllowlist.includes(item))
  const skippedCount = items.length - filtered.length

  const content = readFileSync(filePath, 'utf-8')

  let mentioned = 0
  for (const item of filtered) {
    // Word-boundary match OR substring match
    const wordBoundaryRe = new RegExp(`\\b${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    if (wordBoundaryRe.test(content) || content.includes(item)) {
      mentioned++
    }
  }

  const total = filtered.length
  const ratio = total === 0 ? 1 : mentioned / total
  const percent = Math.round(ratio * 100)
  const actualStr = `${mentioned}/${total} (${percent}%)`
  const expectedStr = `≥${Math.round(minRatio * 100)}% coverage`

  const note = skippedCount > 0 ? `${skippedCount} item${skippedCount !== 1 ? 's' : ''} skipped by valueAllowlist` : undefined

  return [
    {
      file: filePath,
      line: 0,
      actual: actualStr,
      expected: expectedStr,
      status: ratio >= minRatio ? 'pass' : 'fail',
      ...(note !== undefined ? { note } : {}),
    },
  ]
}

// ─── Registry ────────────────────────────────────────────────────────────────

const SCANNERS: Record<string, ScannerFn> = {
  inlineRegex,
  codeBlockRegex,
  yamlField,
  jsonField,
  literalInMd,
  pathReference,
  vaguenessPattern,
  negativeConstraintDensity,
  contextBudget,
  ruleGlobValidity,
  hookValidity,
  backtickEntityPresence,
  skillValidity,
  freshnessScore,
  coverageRatio,
}

/**
 * Scanners that bypass per-file iteration and run once with project root.
 * hookValidity and skillValidity resolve their own targets from root.
 * freshnessScore uses extractor output (expected) directly — root is unused.
 */
export const STANDALONE_SCANNERS: Set<string> = new Set([
  'hookValidity',
  'skillValidity',
  'freshnessScore',
])

/**
 * Register a custom scanner at runtime (plugin API).
 * Pass { standalone: true } for scanners that should run once with root, not per file.
 */
export function registerScanner(name: string, fn: ScannerFn, options?: { standalone?: boolean }): void {
  SCANNERS[name] = fn
  if (options?.standalone === true) {
    STANDALONE_SCANNERS.add(name)
  }
}

export function runScanner(
  name: ScannerName | string,
  filePath: string,
  expected: string,
  args: Record<string, unknown>,
): ScanResult[] {
  const fn = SCANNERS[name]
  if (fn === undefined) throw new Error(`Unknown scanner: "${name}"`)
  return fn(filePath, expected, args)
}
