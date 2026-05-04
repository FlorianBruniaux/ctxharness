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
    expect(result).toBe('4')
  })
  it('returns "0" for no matches', () => {
    expect(
      runExtractor('countMatches', FIXTURES, { path: '.nvmrc', pattern: 'NOMATCH' })
    ).toBe('0')
  })
})

describe('constant extractor', () => {
  it('returns the provided string value', () => {
    expect(runExtractor('constant', FIXTURES, { value: 'check' })).toBe('check')
  })
  it('returns empty string when value is empty string', () => {
    expect(runExtractor('constant', FIXTURES, { value: '' })).toBe('')
  })
  it('throws if value arg is missing', () => {
    expect(() => runExtractor('constant', FIXTURES, {})).toThrow()
  })
})

describe('prismaModel extractor', () => {
  it('counts model blocks in schema.prisma', () => {
    expect(runExtractor('prismaModel', FIXTURES, { path: 'schema.prisma' })).toBe('2')
  })
  it('throws if path arg is missing', () => {
    expect(() => runExtractor('prismaModel', FIXTURES, {})).toThrow()
  })
  it('throws if file not found', () => {
    expect(() =>
      runExtractor('prismaModel', FIXTURES, { path: 'nonexistent-schema.prisma' })
    ).toThrow()
  })
})

describe('prismaEnum extractor', () => {
  it('counts values in a named enum', () => {
    expect(runExtractor('prismaEnum', FIXTURES, { path: 'schema.prisma', enum: 'Role' })).toBe('3')
  })
  it('throws if enum not found', () => {
    expect(() =>
      runExtractor('prismaEnum', FIXTURES, { path: 'schema.prisma', enum: 'NonExistentEnum' })
    ).toThrow()
  })
  it('throws if enum arg is missing', () => {
    expect(() =>
      runExtractor('prismaEnum', FIXTURES, { path: 'schema.prisma' })
    ).toThrow()
  })
})

describe('trpcRouter extractor', () => {
  it('counts router entries in a tRPC root file', () => {
    expect(runExtractor('trpcRouter', FIXTURES, { path: 'trpc-root.ts' })).toBe('3')
  })
  it('throws if path arg is missing', () => {
    expect(() => runExtractor('trpcRouter', FIXTURES, {})).toThrow()
  })
  it('throws if file not found', () => {
    expect(() =>
      runExtractor('trpcRouter', FIXTURES, { path: 'nonexistent-root.ts' })
    ).toThrow()
  })
})

describe('gitStaleness extractor', () => {
  it('returns a numeric string for a tracked file', () => {
    const result = runExtractor('gitStaleness', FIXTURES, { path: '.nvmrc' })
    expect(result).toMatch(/^\d+$/)
  })
  it('throws if path arg is missing', () => {
    expect(() => runExtractor('gitStaleness', FIXTURES, {})).toThrow()
  })
  it('throws if file not found', () => {
    expect(() =>
      runExtractor('gitStaleness', FIXTURES, { path: 'nonexistent-file.txt' })
    ).toThrow()
  })
})

describe('packageEngines extractor', () => {
  it('returns node version from engines field (strips >= operator)', () => {
    expect(runExtractor('packageEngines', FIXTURES, {})).toBe('22.14.0')
  })
  it('uses "node" as default field', () => {
    expect(runExtractor('packageEngines', FIXTURES, { field: 'node' })).toBe('22.14.0')
  })
  it('throws if engines field not present in package.json', () => {
    expect(() =>
      runExtractor('packageEngines', '/tmp/no-such-dir-ctxharness-test', {})
    ).toThrow()
  })
})

describe('tsconfigPaths extractor', () => {
  it('counts path aliases in tsconfig.json', () => {
    expect(runExtractor('tsconfigPaths', FIXTURES, {})).toBe('3')
  })
  it('accepts custom tsconfig path via args', () => {
    expect(runExtractor('tsconfigPaths', FIXTURES, { path: 'tsconfig.json' })).toBe('3')
  })
  it('throws if tsconfig not found', () => {
    expect(() =>
      runExtractor('tsconfigPaths', FIXTURES, { path: 'nonexistent-tsconfig.json' })
    ).toThrow()
  })
})

describe('prismaModelList extractor', () => {
  it('returns a JSON array of model names', () => {
    const result = runExtractor('prismaModelList', FIXTURES, { path: 'schema.prisma' })
    const parsed = JSON.parse(result)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toContain('User')
    expect(parsed).toContain('Post')
  })
  it('returns both model names from the fixture schema', () => {
    const result = runExtractor('prismaModelList', FIXTURES, { path: 'schema.prisma' })
    const parsed = JSON.parse(result) as string[]
    expect(parsed).toHaveLength(2)
  })
  it('throws if path arg is missing', () => {
    expect(() => runExtractor('prismaModelList', FIXTURES, {})).toThrow()
  })
  it('throws if file not found', () => {
    expect(() =>
      runExtractor('prismaModelList', FIXTURES, { path: 'nonexistent-schema.prisma' })
    ).toThrow()
  })
})

describe('trpcRouterList extractor', () => {
  it('returns a JSON array of router names', () => {
    const result = runExtractor('trpcRouterList', FIXTURES, { path: 'trpc-root.ts' })
    const parsed = JSON.parse(result)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toContain('user')
    expect(parsed).toContain('post')
    expect(parsed).toContain('auth')
  })
  it('returns 3 router names from the fixture', () => {
    const result = runExtractor('trpcRouterList', FIXTURES, { path: 'trpc-root.ts' })
    const parsed = JSON.parse(result) as string[]
    expect(parsed).toHaveLength(3)
  })
  it('throws if path arg is missing', () => {
    expect(() => runExtractor('trpcRouterList', FIXTURES, {})).toThrow()
  })
  it('throws if file not found', () => {
    expect(() =>
      runExtractor('trpcRouterList', FIXTURES, { path: 'nonexistent-root.ts' })
    ).toThrow()
  })
})
