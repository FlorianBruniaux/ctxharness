import { describe, it, expect } from 'vitest'
import { populateFromConfig, assertionsToYaml } from '../populate.js'
import type { PopulateResult } from '../populate.js'
import type { CtxharnessConfig } from '../config.js'
import type { HeuristicClaim } from '../scan.js'

function makeConfig(assertionIds: string[] = []): CtxharnessConfig {
  return {
    version: 1,
    files: { include: ['CLAUDE.md'], exclude: ['node_modules/**'] },
    assertions: assertionIds.map((id) => ({
      id,
      extractor: 'nvmrc' as const,
      scanner: 'inlineRegex' as const,
      scannerArgs: { pattern: 'x' },
    })),
  }
}

function makeClaim(overrides: Partial<HeuristicClaim> = {}): HeuristicClaim {
  return {
    type: 'semver',
    raw: '22.14.0',
    value: '22.14.0',
    tech: 'node',
    line: 1,
    ...overrides,
  }
}

// ─── populateFromConfig ───────────────────────────────────────────────────────

describe('populateFromConfig', () => {
  it('returns empty suggested and skippedIds when no claims', () => {
    const result = populateFromConfig(makeConfig(), [])
    expect(result.suggested).toHaveLength(0)
    expect(result.skippedIds).toHaveLength(0)
  })

  it('maps a node semver claim → nvmrc extractor + inlineRegex scanner', () => {
    const claim = makeClaim({ type: 'semver', tech: 'node', value: '22.14.0' })
    const result = populateFromConfig(makeConfig(), [claim])
    expect(result.suggested).toHaveLength(1)
    const a = result.suggested[0]!
    expect(a.id).toBe('node-version')
    expect(a.extractor).toBe('nvmrc')
    expect(a.scanner).toBe('inlineRegex')
    const pattern = (a.scannerArgs as Record<string, string>)['pattern']!
    expect(pattern).toContain('Node')
  })

  it('maps a nodejs alias claim identically to node', () => {
    const claim = makeClaim({ type: 'semver', tech: 'nodejs', value: '20.0.0' })
    const result = populateFromConfig(makeConfig(), [claim])
    expect(result.suggested).toHaveLength(1)
    expect(result.suggested[0]!.id).toBe('node-version')
    expect(result.suggested[0]!.extractor).toBe('nvmrc')
  })

  it('maps a non-node semver claim → packageJson extractor', () => {
    const claim = makeClaim({ type: 'semver', tech: 'typescript', value: '5.8' })
    const result = populateFromConfig(makeConfig(), [claim])
    expect(result.suggested).toHaveLength(1)
    const a = result.suggested[0]!
    expect(a.id).toBe('typescript-version')
    expect(a.extractor).toBe('packageJson')
    expect((a.extractorArgs as Record<string, string>)['package']).toBe('typescript')
    expect(a.scanner).toBe('inlineRegex')
  })

  it('maps a path claim → fileExists extractor + literalInMd scanner', () => {
    const claim = makeClaim({ type: 'path', tech: '', raw: 'src/index.ts', value: 'src/index.ts' })
    const result = populateFromConfig(makeConfig(), [claim])
    expect(result.suggested).toHaveLength(1)
    const a = result.suggested[0]!
    expect(a.id).toBe('path-src-index-ts')
    expect(a.extractor).toBe('fileExists')
    expect((a.extractorArgs as Record<string, string>)['path']).toBe('src/index.ts')
    expect(a.scanner).toBe('literalInMd')
    expect((a.scannerArgs as Record<string, string>)['literal']).toBe('src/index.ts')
  })

  it('maps a script claim → packageScript extractor + literalInMd scanner', () => {
    const claim = makeClaim({ type: 'script', tech: 'pnpm', raw: 'pnpm run build', value: 'build' })
    const result = populateFromConfig(makeConfig(), [claim])
    expect(result.suggested).toHaveLength(1)
    const a = result.suggested[0]!
    expect(a.id).toBe('script-build')
    expect(a.extractor).toBe('packageScript')
    expect((a.extractorArgs as Record<string, string>)['script']).toBe('build')
    expect(a.scanner).toBe('literalInMd')
    expect((a.scannerArgs as Record<string, string>)['literal']).toBe('pnpm run build')
  })

  it('skips claim whose generated ID already exists in config.assertions', () => {
    const claim = makeClaim({ type: 'semver', tech: 'node', value: '22.0.0' })
    const result = populateFromConfig(makeConfig(['node-version']), [claim])
    expect(result.suggested).toHaveLength(0)
    expect(result.skippedIds).toContain('node-version')
  })

  it('deduplicates claims that produce the same ID — keeps only first', () => {
    const c1 = makeClaim({ type: 'semver', tech: 'node', value: '20.0.0', line: 1 })
    const c2 = makeClaim({ type: 'semver', tech: 'node', value: '22.0.0', line: 5 })
    const result = populateFromConfig(makeConfig(), [c1, c2])
    expect(result.suggested).toHaveLength(1)
  })

  it('handles multiple distinct claim types without cross-contamination', () => {
    const claims = [
      makeClaim({ type: 'semver', tech: 'node', value: '22.0.0' }),
      makeClaim({ type: 'path', tech: '', raw: './src', value: './src' }),
      makeClaim({ type: 'script', tech: 'pnpm', raw: 'pnpm test', value: 'test' }),
    ]
    const result = populateFromConfig(makeConfig(), claims)
    expect(result.suggested).toHaveLength(3)
    expect(result.suggested.map((a) => a.id)).toEqual(
      expect.arrayContaining(['node-version', 'path--src', 'script-test'])
    )
  })
})

// ─── assertionsToYaml ─────────────────────────────────────────────────────────

describe('assertionsToYaml', () => {
  it('returns empty string for empty array', () => {
    expect(assertionsToYaml([])).toBe('')
  })

  it('returns YAML with correct extractor and scanner for a node-version assertion', () => {
    const { suggested } = populateFromConfig(makeConfig(), [
      makeClaim({ type: 'semver', tech: 'node', value: '22.0.0' }),
    ])
    const yaml = assertionsToYaml(suggested)
    expect(yaml).toContain('id: node-version')
    expect(yaml).toContain('extractor: nvmrc')
    expect(yaml).toContain('scanner: inlineRegex')
    expect(yaml).toContain('scannerArgs:')
  })

  it('each assertion block starts with "  - id:" (2-space indent for YAML list)', () => {
    const { suggested } = populateFromConfig(makeConfig(), [
      makeClaim({ type: 'semver', tech: 'node', value: '22.0.0' }),
    ])
    const yaml = assertionsToYaml(suggested)
    const firstLine = yaml.split('\n')[0]!
    expect(firstLine).toMatch(/^  - id:/)
  })

  it('serialises extractorArgs when present', () => {
    const { suggested } = populateFromConfig(makeConfig(), [
      makeClaim({ type: 'semver', tech: 'typescript', value: '5.8' }),
    ])
    const yaml = assertionsToYaml(suggested)
    expect(yaml).toContain('extractorArgs:')
    expect(yaml).toContain("package: 'typescript'")
  })

  it('serialises two assertions separated by a blank line', () => {
    const claims = [
      makeClaim({ type: 'semver', tech: 'node', value: '22.0.0' }),
      makeClaim({ type: 'semver', tech: 'typescript', value: '5.8' }),
    ]
    const { suggested } = populateFromConfig(makeConfig(), claims)
    const yaml = assertionsToYaml(suggested)
    // Should contain two id: blocks
    const idCount = (yaml.match(/^\s+- id:/gm) ?? []).length
    expect(idCount).toBe(2)
  })
})
