import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import type { ScannerName } from '../config.js'

// ─── Public types ────────────────────────────────────────────────────────────

export type ScanResult = {
  file: string     // absolute path
  line: number     // 1-indexed (0 if no position available)
  actual: string   // what was found in the doc
  expected: string // what the extractor said
  status: 'pass' | 'fail'
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

// ─── Registry ────────────────────────────────────────────────────────────────

const SCANNERS: Record<ScannerName, ScannerFn> = {
  inlineRegex,
  codeBlockRegex,
  yamlField,
  jsonField,
  literalInMd,
  pathReference,
  vaguenessPattern,
  negativeConstraintDensity,
}

export function runScanner(
  name: ScannerName,
  filePath: string,
  expected: string,
  args: Record<string, unknown>,
): ScanResult[] {
  const fn = SCANNERS[name]
  return fn(filePath, expected, args)
}
