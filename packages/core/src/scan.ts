import { readFileSync } from 'node:fs'
import { runExtractor } from './extractors/index.js'
import { normalizeMatch } from './scanners/index.js'

// ─── Public types ─────────────────────────────────────────────────────────────

export type ClaimType = 'semver' | 'path' | 'script'
export type ClaimStatus = 'match' | 'drift' | 'error' | 'unresolvable'

export interface HeuristicClaim {
  type: ClaimType
  raw: string   // text inside backticks, e.g. "npm run typecheck"
  value: string // extracted core value: "typecheck", "22.0.0", "src/foo.ts"
  tech: string  // for semver: tech keyword ("node", "pnpm", "next"); for path/script: ""
  line: number  // 1-based line number in the source file
}

export interface HeuristicResult {
  claim: HeuristicClaim
  detected: string // what was found in the doc (same as claim.value for display)
  actual: string   // what the extractor returned, or error message
  status: ClaimStatus
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SEMVER_TECH_KEYWORDS = [
  'node', 'nodejs', 'pnpm', 'npm', 'yarn', 'bun',
  'python', 'go', 'rust', 'cargo', 'next', 'nextjs',
  'react', 'typescript', 'ts', 'vitest', 'jest', 'deno',
]

const SCRIPT_EXCLUDE = new Set([
  'install', 'add', 'remove', 'update', 'init', 'ci',
  'publish', 'link', 'unlink',
])

// ─── Heuristic detection ─────────────────────────────────────────────────────

/**
 * Detect verifiable claims in a markdown/text document.
 * Returns deduplicated, ordered list of HeuristicClaim objects.
 */
export function detectClaims(content: string): HeuristicClaim[] {
  const lines = content.split('\n')
  const results: HeuristicClaim[] = []

  // Deduplication sets
  const seenSemver = new Set<string>() // "tech:value"
  const seenPaths = new Set<string>()  // path value
  const seenScripts = new Set<string>() // "tech:value"

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    const lineNum = i + 1

    detectSemverClaims(line, lineNum, seenSemver, results)
    detectPathClaims(line, lineNum, seenPaths, results)
    detectScriptClaims(line, lineNum, seenScripts, results)
  }

  return results
}

// ─── Heuristic 1: Semver ──────────────────────────────────────────────────────

function detectSemverClaims(
  line: string,
  lineNum: number,
  seen: Set<string>,
  results: HeuristicClaim[],
): void {
  const semverRe = /`(\d+\.\d+(?:\.\d+)?)`/g
  let match: RegExpExecArray | null

  while ((match = semverRe.exec(line)) !== null) {
    const raw = match[1]
    if (raw === undefined) continue

    // False-positive filter: skip URL-like context
    const before = line.slice(0, match.index)
    if (/(?:\/v|:\/\/v|api-v\d)$/.test(before)) continue

    // False-positive filter: skip version ranges
    if (/[<>]=?\s*$/.test(before)) continue

    // Find a tech keyword within 80 chars on the same line
    const windowStart = Math.max(0, match.index - 80)
    const windowEnd = Math.min(line.length, match.index + match[0].length + 80)
    const window = line.slice(windowStart, windowEnd).toLowerCase()

    let matchedTech: string | undefined
    for (const kw of SEMVER_TECH_KEYWORDS) {
      // Use word-boundary style matching — keyword must appear as a word
      const kwRe = new RegExp(`(?:^|[^a-z])${kw}(?:[^a-z]|$)`)
      if (kwRe.test(window)) {
        matchedTech = kw
        break
      }
    }

    if (matchedTech === undefined) continue

    const dedupeKey = `${matchedTech}:${raw}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    results.push({
      type: 'semver',
      raw,
      value: raw,
      tech: matchedTech,
      line: lineNum,
    })
  }
}

// ─── Heuristic 2: File paths ──────────────────────────────────────────────────

const PATH_RE =
  /`([./][^\s`]+|[a-zA-Z][^\s`]*\.(ts|tsx|js|jsx|py|rs|go|json|yml|yaml|md|sh|toml))`/g

function detectPathClaims(
  line: string,
  lineNum: number,
  seen: Set<string>,
  results: HeuristicClaim[],
): void {
  const re = new RegExp(PATH_RE.source, 'g')
  let match: RegExpExecArray | null

  while ((match = re.exec(line)) !== null) {
    const raw = match[1]
    if (raw === undefined) continue

    // Skip URLs
    if (raw.startsWith('http://') || raw.startsWith('https://')) continue

    // Skip snake_case-only non-path strings (e.g. Rust crate names like `ruff_python_ast`)
    if (!raw.includes('/') && /^[a-zA-Z][a-zA-Z0-9_]*\.[a-z]+$/.test(raw)) {
      // Only allow if it has a real path indicator (starts with . / src etc.)
      // Pure name.ext with underscores and no slash is a false positive
      if (raw.includes('_') && !raw.startsWith('./') && !raw.startsWith('/')) continue
    }

    if (seen.has(raw)) continue
    seen.add(raw)

    results.push({
      type: 'path',
      raw,
      value: raw,
      tech: '',
      line: lineNum,
    })
  }
}

// ─── Heuristic 3: npm/pnpm/yarn scripts ──────────────────────────────────────

function detectScriptClaims(
  line: string,
  lineNum: number,
  seen: Set<string>,
  results: HeuristicClaim[],
): void {
  // Also capture the manager to set tech properly
  const scriptWithManagerRe =
    /`(npm|pnpm|yarn)(?:\s+run)?\s+([a-zA-Z][a-zA-Z0-9:_-]*)`/g
  let match: RegExpExecArray | null

  while ((match = scriptWithManagerRe.exec(line)) !== null) {
    const manager = match[1]
    const scriptName = match[2]
    if (manager === undefined || scriptName === undefined) continue

    if (SCRIPT_EXCLUDE.has(scriptName)) continue

    const dedupeKey = `${manager}:${scriptName}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    // raw is the full command inside backticks
    const fullRaw = match[0].slice(1, -1) // strip surrounding backticks

    results.push({
      type: 'script',
      raw: fullRaw,
      value: scriptName,
      tech: manager,
      line: lineNum,
    })
  }
}

// ─── Claim verification ───────────────────────────────────────────────────────

/**
 * Run the appropriate extractor for a claim and compare against the doc value.
 */
export function verifyClaim(claim: HeuristicClaim, root: string): HeuristicResult {
  try {
    if (claim.type === 'semver') {
      return verifySemverClaim(claim, root)
    } else if (claim.type === 'path') {
      return verifyPathClaim(claim, root)
    } else {
      return verifyScriptClaim(claim, root)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      claim,
      detected: claim.value,
      actual: msg,
      status: 'unresolvable',
    }
  }
}

function verifySemverClaim(claim: HeuristicClaim, root: string): HeuristicResult {
  const tech = claim.tech

  let actual: string
  if (tech === 'node' || tech === 'nodejs') {
    try {
      actual = runExtractor('nvmrc', root, {})
    } catch {
      actual = runExtractor('packageEngines', root, { field: 'node' })
    }
  } else if (tech === 'pnpm' || tech === 'npm' || tech === 'yarn' || tech === 'bun') {
    actual = runExtractor('packageManager', root, {})
  } else {
    actual = runExtractor('packageJson', root, { package: tech })
  }

  const matched = normalizeMatch(claim.value, actual)
  return {
    claim,
    detected: claim.value,
    actual,
    status: matched ? 'match' : 'drift',
  }
}

function verifyPathClaim(claim: HeuristicClaim, root: string): HeuristicResult {
  const actual = runExtractor('fileExists', root, { path: claim.value })
  if (actual === 'true') {
    return {
      claim,
      detected: 'mentioned',
      actual: 'exists',
      status: 'match',
    }
  }
  return {
    claim,
    detected: 'mentioned',
    actual: 'NOT FOUND',
    status: 'drift',
  }
}

function verifyScriptClaim(claim: HeuristicClaim, root: string): HeuristicResult {
  const actual = runExtractor('packageScript', root, { script: claim.value })
  if (actual === 'true') {
    return {
      claim,
      detected: 'mentioned',
      actual: 'in scripts',
      status: 'match',
    }
  }
  return {
    claim,
    detected: 'mentioned',
    actual: 'NOT in scripts',
    status: 'drift',
  }
}

// ─── Convenience function ─────────────────────────────────────────────────────

/**
 * Read a file, detect heuristic claims, verify each against extractors, return results.
 */
export function scanFile(filePath: string, root: string): HeuristicResult[] {
  const content = readFileSync(filePath, 'utf-8')
  const claims = detectClaims(content)
  return claims.map((claim) => verifyClaim(claim, root))
}
