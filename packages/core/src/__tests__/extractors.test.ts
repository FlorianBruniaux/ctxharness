import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { runExtractor } from '../extractors/index.js'

const FIXTURES = join(import.meta.dirname, 'fixtures')

describe('packageJson extractor', () => {
  it('returns version for a known dep', () => {
    expect(runExtractor('packageJson', FIXTURES, { package: 'next' })).toBe('15.3.1')
  })
  it('returns version from devDependencies', () => {
    expect(runExtractor('packageJson', FIXTURES, { package: 'typescript' })).toBe('5.8.3')
  })
  it('throws for unknown package', () => {
    expect(() => runExtractor('packageJson', FIXTURES, { package: 'nonexistent-xyz' })).toThrow()
  })
  it('throws if package arg missing', () => {
    expect(() => runExtractor('packageJson', FIXTURES, {})).toThrow()
  })
})

describe('packageManager extractor', () => {
  it('extracts pnpm version stripping corepack hash', () => {
    expect(runExtractor('packageManager', FIXTURES, {})).toBe('9.4.0')
  })
})

describe('nvmrc extractor', () => {
  it('reads .nvmrc and trims whitespace', () => {
    expect(runExtractor('nvmrc', FIXTURES, {})).toBe('22.14.0')
  })
  it('throws if .nvmrc missing', () => {
    expect(() => runExtractor('nvmrc', '/tmp/no-such-dir-ctxharness-test', {})).toThrow()
  })
})

describe('fileExists extractor', () => {
  it('returns "true" for existing file', () => {
    expect(runExtractor('fileExists', FIXTURES, { path: 'package.json' })).toBe('true')
  })
  it('returns "false" for missing file', () => {
    expect(runExtractor('fileExists', FIXTURES, { path: 'nonexistent.txt' })).toBe('false')
  })
})

describe('regexScan extractor', () => {
  it('extracts capture group from file', () => {
    const result = runExtractor('regexScan', FIXTURES, {
      path: '.nvmrc',
      pattern: '(\\d+\\.\\d+\\.\\d+)',
    })
    expect(result).toBe('22.14.0')
  })
  it('throws if no match', () => {
    expect(() =>
      runExtractor('regexScan', FIXTURES, { path: '.nvmrc', pattern: 'NOMATCH(xyz)' })
    ).toThrow()
  })
})

describe('countMatches extractor', () => {
  it('counts enum values in prisma file', () => {
    const result = runExtractor('countMatches', FIXTURES, {
      path: 'schema.prisma',
      pattern: '\\b(USER|ADMIN|MODERATOR)\\b',
    })
    expect(result).toBe('3')
  })
  it('returns "0" for no matches', () => {
    expect(
      runExtractor('countMatches', FIXTURES, { path: '.nvmrc', pattern: 'NOMATCH' })
    ).toBe('0')
  })
})
