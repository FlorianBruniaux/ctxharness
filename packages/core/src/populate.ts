import type { Assertion, CtxharnessConfig } from './config.js'
import type { HeuristicClaim } from './scan.js'

export interface PopulateResult {
  suggested: Assertion[]
  skippedIds: string[]
}

function claimId(claim: HeuristicClaim): string {
  if (claim.type === 'semver') {
    const tech = claim.tech === 'nodejs' ? 'node' : claim.tech
    return `${tech}-version`
  }
  if (claim.type === 'path') {
    const safe = claim.value.replace(/[^a-zA-Z0-9]/g, '-').replace(/^-|-$/g, '')
    return `path-${safe}`
  }
  const safe = claim.value.replace(/[^a-zA-Z0-9]/g, '-').replace(/^-|-$/g, '')
  return `script-${safe}`
}

function claimToAssertion(claim: HeuristicClaim): Assertion {
  if (claim.type === 'semver') {
    const tech = claim.tech === 'nodejs' ? 'node' : claim.tech
    if (tech === 'node') {
      return {
        id: 'node-version',
        extractor: 'nvmrc',
        scanner: 'inlineRegex',
        scannerArgs: { pattern: 'Node(?:\\.js)?\\s+v?(\\d+(?:\\.\\d+(?:\\.\\d+)?)?)' },
      }
    }
    return {
      id: `${tech}-version`,
      extractor: 'packageJson',
      extractorArgs: { package: tech },
      scanner: 'inlineRegex',
      scannerArgs: { pattern: `${tech}\\s+v?(\\d+(?:\\.\\d+(?:\\.\\d+)?)?)` },
    }
  }

  if (claim.type === 'path') {
    const safe = claim.value.replace(/[^a-zA-Z0-9]/g, '-').replace(/^-|-$/g, '')
    return {
      id: `path-${safe}`,
      extractor: 'fileExists',
      extractorArgs: { path: claim.value },
      scanner: 'literalInMd',
      scannerArgs: { literal: claim.value },
    }
  }

  const safe = claim.value.replace(/[^a-zA-Z0-9]/g, '-').replace(/^-|-$/g, '')
  return {
    id: `script-${safe}`,
    extractor: 'packageScript',
    extractorArgs: { script: claim.value },
    scanner: 'literalInMd',
    scannerArgs: { literal: claim.raw },
  }
}

export function populateFromConfig(
  config: CtxharnessConfig,
  claims: HeuristicClaim[],
): PopulateResult {
  const existingIds = new Set(config.assertions.map((a) => a.id))
  const seenIds = new Set<string>(existingIds)
  const suggested: Assertion[] = []
  const skippedIds: string[] = []

  for (const claim of claims) {
    const id = claimId(claim)
    if (existingIds.has(id) && !skippedIds.includes(id)) {
      skippedIds.push(id)
      continue
    }
    if (seenIds.has(id)) continue
    seenIds.add(id)
    suggested.push(claimToAssertion(claim))
  }

  return { suggested, skippedIds }
}

function yamlQ(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

export function assertionsToYaml(assertions: Assertion[]): string {
  if (assertions.length === 0) return ''

  const lines: string[] = []
  for (const a of assertions) {
    lines.push(`  - id: ${a.id}`)
    lines.push(`    extractor: ${a.extractor}`)
    if (a.extractorArgs !== undefined && Object.keys(a.extractorArgs).length > 0) {
      lines.push(`    extractorArgs:`)
      for (const [k, v] of Object.entries(a.extractorArgs)) {
        lines.push(`      ${k}: ${yamlQ(String(v))}`)
      }
    }
    lines.push(`    scanner: ${a.scanner}`)
    if (a.scannerArgs !== undefined && Object.keys(a.scannerArgs).length > 0) {
      lines.push(`    scannerArgs:`)
      for (const [k, v] of Object.entries(a.scannerArgs)) {
        lines.push(`      ${k}: ${yamlQ(String(v))}`)
      }
    }
  }

  return lines.join('\n')
}
