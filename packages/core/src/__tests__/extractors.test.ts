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

describe('pyprojectToml extractor', () => {
  it('returns project.version by default (PEP 621)', () => {
    expect(runExtractor('pyprojectToml', FIXTURES, {})).toBe('1.2.3')
  })
  it('returns dependency version from PEP 621 dependencies array', () => {
    expect(runExtractor('pyprojectToml', FIXTURES, { package: 'requests' })).toBe('2.28.0')
  })
  it('returns dependency version from tool.poetry.dependencies (string)', () => {
    expect(runExtractor('pyprojectToml', FIXTURES, { package: 'django' })).toBe('4.2.0')
  })
  it('returns dependency version from tool.poetry.dependencies (object)', () => {
    expect(runExtractor('pyprojectToml', FIXTURES, { package: 'sqlalchemy' })).toBe('2.0.0')
  })
  it('returns field value via dot-path', () => {
    expect(runExtractor('pyprojectToml', FIXTURES, { field: 'project.name' })).toBe('my-python-app')
  })
  it('throws for unknown package', () => {
    expect(() =>
      runExtractor('pyprojectToml', FIXTURES, { package: 'nonexistent-xyz' })
    ).toThrow()
  })
})

describe('requirementsTxt extractor', () => {
  it('extracts == pinned version', () => {
    expect(runExtractor('requirementsTxt', FIXTURES, { package: 'django' })).toBe('4.2.0')
  })
  it('extracts >= version', () => {
    expect(runExtractor('requirementsTxt', FIXTURES, { package: 'requests' })).toBe('2.28.0')
  })
  it('extracts ~= version', () => {
    expect(runExtractor('requirementsTxt', FIXTURES, { package: 'numpy' })).toBe('1.24.0')
  })
  it('extracts package with extras notation', () => {
    expect(runExtractor('requirementsTxt', FIXTURES, { package: 'Flask' })).toBe('2.3.0')
  })
  it('throws when package not found', () => {
    expect(() =>
      runExtractor('requirementsTxt', FIXTURES, { package: 'nonexistent-xyz' })
    ).toThrow()
  })
})

describe('cargoToml extractor', () => {
  it('returns package.version by default', () => {
    expect(runExtractor('cargoToml', FIXTURES, {})).toBe('0.3.1')
  })
  it('returns dependency version in string format', () => {
    expect(runExtractor('cargoToml', FIXTURES, { package: 'tokio' })).toBe('1.35.1')
  })
  it('returns dependency version in object format', () => {
    expect(runExtractor('cargoToml', FIXTURES, { package: 'serde' })).toBe('1.0.193')
  })
  it('returns dev-dependency version', () => {
    expect(runExtractor('cargoToml', FIXTURES, { package: 'criterion' })).toBe('0.5.1')
  })
  it('returns field value via dot-path', () => {
    expect(runExtractor('cargoToml', FIXTURES, { field: 'package.name' })).toBe('my-rust-app')
  })
  it('throws for unknown crate', () => {
    expect(() =>
      runExtractor('cargoToml', FIXTURES, { package: 'nonexistent-xyz' })
    ).toThrow()
  })
})

describe('cargoToml extractor — workspace', () => {
  const WS = join(FIXTURES, 'workspace')
  it('returns workspace.package.version by default', () => {
    expect(runExtractor('cargoToml', WS, {})).toBe('0.22.0')
  })
  it('returns workspace dependency version in object format', () => {
    expect(runExtractor('cargoToml', WS, { package: 'tokio' })).toBe('1.36.0')
  })
  it('returns workspace dependency version in string format', () => {
    expect(runExtractor('cargoToml', WS, { package: 'ratatui' })).toBe('0.30.0')
  })
  it('throws for unknown crate in workspace', () => {
    expect(() => runExtractor('cargoToml', WS, { package: 'nonexistent-xyz' })).toThrow()
  })
})

describe('packageScript extractor', () => {
  it('returns "true" when the script exists', () => {
    expect(
      runExtractor('packageScript', FIXTURES, { script: 'typecheck', file: 'package-with-scripts.json' })
    ).toBe('true')
  })
  it('returns "true" for another existing script', () => {
    expect(
      runExtractor('packageScript', FIXTURES, { script: 'build', file: 'package-with-scripts.json' })
    ).toBe('true')
  })
  it('returns "false" when the script is absent', () => {
    expect(
      runExtractor('packageScript', FIXTURES, { script: 'nonexistent-script', file: 'package-with-scripts.json' })
    ).toBe('false')
  })
  it('returns "false" when the scripts field is missing', () => {
    expect(
      runExtractor('packageScript', FIXTURES, { script: 'build', file: 'package-no-scripts.json' })
    ).toBe('false')
  })
  it('throws when the script arg is missing', () => {
    expect(() =>
      runExtractor('packageScript', FIXTURES, { file: 'package-with-scripts.json' })
    ).toThrow()
  })
  it('throws when the file is not found', () => {
    expect(() =>
      runExtractor('packageScript', FIXTURES, { script: 'build', file: 'nonexistent-package.json' })
    ).toThrow()
  })
  it('throws when package.json contains invalid JSON', () => {
    expect(() =>
      runExtractor('packageScript', FIXTURES, { script: 'build', file: 'package-invalid.json' })
    ).toThrow()
  })
  it('uses custom file arg to read from a specific path', () => {
    expect(
      runExtractor('packageScript', FIXTURES, { script: 'test', file: 'package-with-scripts.json' })
    ).toBe('true')
  })
})

describe('goMod extractor', () => {
  it('extracts module version from require block', () => {
    expect(
      runExtractor('goMod', FIXTURES, { module: 'github.com/gin-gonic/gin' })
    ).toBe('1.9.1')
  })
  it('extracts version with // indirect comment', () => {
    expect(
      runExtractor('goMod', FIXTURES, { module: 'github.com/bytedance/sonic' })
    ).toBe('1.9.1')
  })
  it('throws for unknown module', () => {
    expect(() =>
      runExtractor('goMod', FIXTURES, { module: 'github.com/nonexistent/pkg' })
    ).toThrow()
  })
  it('throws when module arg is missing', () => {
    expect(() => runExtractor('goMod', FIXTURES, {})).toThrow()
  })
})
