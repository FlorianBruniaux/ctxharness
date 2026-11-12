import * as fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkConfigExpectations,
  loadConfigExpectations,
  parseConfigExpectations,
} from '../expectations.js'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, lstatSync: vi.fn(actual.lstatSync) }
})

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'ctx-expect-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})
const file = (state: 'present' | 'absent', path = 'rule.md') => ({
  id: 'rule',
  kind: 'file',
  path,
  state,
})
const mcp = (state: 'present' | 'absent') => ({
  id: 'design',
  kind: 'mcp-server',
  path: '.mcp.json',
  name: 'design_fixture',
  state,
})
const contract = (expectations: unknown[] = [file('present')]) => ({
  schemaVersion: 1,
  host: 'claude',
  scope: 'project',
  expectations,
})
const evaluate = (expectations: unknown[]) =>
  checkConfigExpectations({ root, expectations: parseConfigExpectations(contract(expectations)) })
const write = (path: string, content: string) => {
  fs.mkdirSync(join(root, path, '..'), { recursive: true })
  fs.writeFileSync(join(root, path), content)
}

function assertResult(items: unknown[], status: string) {
  const findings = evaluate(items)
  expect(findings).toHaveLength(items.length + 1)
  expect(findings[0]).toMatchObject({
    status,
    capability: items[0] && (items[0] as { id: string }).id,
  })
  expect(findings.at(-1)).toMatchObject({ status: status === 'pass' ? 'pass' : 'fail' })
  return findings
}

describe('explicit config expectations', () => {
  it.each([
    ['present', false, 'fail'],
    ['absent', false, 'pass'],
    ['present', true, 'pass'],
    ['absent', true, 'fail'],
  ] as const)('checks %s against file existence %s', (state, exists, wanted) => {
    if (exists) write('rule.md', 'inert')
    assertResult([file(state)], wanted)
  })
  it('does not treat a directory as a required regular file', () => {
    fs.mkdirSync(join(root, 'rule.md'))
    assertResult([file('present')], 'fail')
    assertResult([file('absent')], 'fail')
  })
  it('recognizes a missing nested path through ordinary directories', () => {
    fs.mkdirSync(join(root, 'rules'))
    assertResult([file('absent', 'rules/missing/deeper.md')], 'pass')
  })
  it('does not treat a non-directory parent as absence', () => {
    write('rules', 'not a directory')
    assertResult([file('absent', 'rules/missing.md')], 'unknown')
  })
  it('does not treat an unavailable project root as universal absence', () => {
    fs.rmSync(root, { recursive: true })
    assertResult([file('absent')], 'unknown')
  })
  it('rejects a parent symlink even if its target is inside the project', () => {
    fs.mkdirSync(join(root, 'real'))
    fs.symlinkSync('real', join(root, 'alias'))
    assertResult([file('absent', 'alias/missing.md')], 'unknown')
  })
  it('treats a dangling final symlink as present for an absence expectation', () => {
    fs.symlinkSync('missing', join(root, 'rule.md'))
    assertResult([file('absent')], 'fail')
    assertResult([file('present')], 'unknown')
  })
  it('does not follow an outside symlink', () => {
    fs.symlinkSync('/outside-the-fixture', join(root, 'alias'))
    assertResult([file('present', 'alias/private.md')], 'unknown')
  })
  it('keeps an access failure unknown rather than absent', async () => {
    const real = (await vi.importActual<typeof fs>('node:fs')).lstatSync
    vi.spyOn(fs, 'lstatSync').mockImplementation(((path: fs.PathLike, ...args: unknown[]) => {
      if (String(path) === join(fs.realpathSync(root), 'rule.md'))
        throw Object.assign(new Error('private'), { code: 'EACCES' })
      return Reflect.apply(real, fs, [path, ...args])
    }) as typeof fs.lstatSync)
    const findings = assertResult([file('absent')], 'unknown')
    expect(JSON.stringify(findings)).not.toContain('private')
  })
  it('does not read a required FIFO or claim it is absent', () => {
    expect(spawnSync('mkfifo', [join(root, 'rule.md')]).status).toBe(0)
    assertResult([file('present')], 'unknown')
    assertResult([file('absent')], 'fail')
  })
  it('keeps an oversized required file unresolved', () => {
    write('rule.md', 'x'.repeat(1_000_001))
    assertResult([file('present')], 'unknown')
  })
  it.each(['present', 'absent'] as const)('checks named MCP server %s', (state) => {
    write(
      '.mcp.json',
      JSON.stringify({
        mcpServers: { design_fixture: { command: 'do-not-run', args: ['PRIVATE_VALUE'] } },
      }),
    )
    const findings = assertResult([mcp(state)], state === 'present' ? 'pass' : 'fail')
    expect(JSON.stringify(findings)).not.toContain('PRIVATE_VALUE')
    expect(JSON.stringify(findings)).not.toContain('do-not-run')
  })
  it('supports an absent MCP file and a valid empty server object', () => {
    assertResult([mcp('absent')], 'pass')
    assertResult([mcp('present')], 'fail')
    write('.mcp.json', '{"mcpServers":{}}')
    assertResult([mcp('absent')], 'pass')
    assertResult([mcp('present')], 'fail')
  })
  it.each([
    '{bad',
    'null',
    '[]',
    '{}',
    '{"mcpServers":[]}',
    '{"mcpServers":null}',
    '{"mcpServers":{"design_fixture":false}}',
    '{"mcpServers":{"design_fixture":[]}}',
  ])('does not infer absence from malformed MCP %s', (content) => {
    write('.mcp.json', content)
    assertResult([mcp('absent')], 'unknown')
  })
  it('does not discover a server through an inherited object key', () => {
    write('.mcp.json', '{"mcpServers":{}}')
    assertResult([{ ...mcp('absent'), name: 'toString' }], 'pass')
  })
  it('preserves ordered results and fails the contract if any expectation is unresolved', () => {
    write('rule.md', 'ok')
    write('.mcp.json', '{}')
    const findings = evaluate([file('present'), mcp('absent')])
    expect(findings.map((f) => f.status)).toEqual(['pass', 'unknown', 'fail'])
    expect(findings[1]).toMatchObject({
      reason: 'missing-evidence',
      expected: 'absent',
      observed: 'unresolved',
    })
  })
})

describe('expectation contract input', () => {
  it.each([
    { ...contract(), schemaVersion: 2 },
    { ...contract(), host: 'codex' },
    { ...contract(), scope: 'both' },
    { ...contract(), extra: true },
    contract([]),
    contract(
      Array.from({ length: 101 }, (_, i) => ({
        ...file('present'),
        id: `id${i}`,
        path: `file${i}`,
      })),
    ),
    contract([file('present'), { ...file('absent'), id: 'different' }]),
    contract([file('present'), { ...file('present', 'other'), id: 'rule' }]),
    contract([{ ...file('present'), extra: true }]),
    contract([{ ...mcp('present'), path: '.claude/.mcp.json' }]),
    contract([{ ...file('present'), id: 'x'.repeat(65) }]),
    contract([{ ...mcp('present'), name: 'a b' }]),
  ])('rejects invalid input %#', (value) => {
    expect(() => parseConfigExpectations(value)).toThrow()
    expect(() => checkConfigExpectations({ root, expectations: value as never })).toThrow()
  })
  it.each([
    '../private',
    '/private',
    'a/../b',
    'a/./b',
    'a//b',
    'a\\b',
    'https://example.com/a',
    'C:/private',
    'a\0b',
    '',
    'x'.repeat(513),
  ])('rejects an unsafe path %s', (path) => {
    expect(() => parseConfigExpectations(contract([file('present', path)]))).toThrow()
  })
  it('loads only an explicit regular bounded JSON contract', () => {
    write('contract.json', JSON.stringify(contract()))
    expect(loadConfigExpectations(join(root, 'contract.json'))).toEqual(contract())
    write('invalid.json', '{SECRET_INVALID')
    expect(() => loadConfigExpectations(join(root, 'invalid.json'))).toThrow()
    try {
      loadConfigExpectations(join(root, 'invalid.json'))
    } catch (error) {
      expect(String(error)).not.toContain('SECRET_INVALID')
    }
    write('big.json', ' '.repeat(1_000_001))
    expect(() => loadConfigExpectations(join(root, 'big.json'))).toThrow()
    fs.symlinkSync('contract.json', join(root, 'link.json'))
    expect(() => loadConfigExpectations(join(root, 'link.json'))).toThrow()
    expect(() => loadConfigExpectations(root)).toThrow()
  })
  it('rejects a FIFO contract without blocking', () => {
    expect(spawnSync('mkfifo', [join(root, 'pipe.json')]).status).toBe(0)
    expect(() => loadConfigExpectations(join(root, 'pipe.json'))).toThrow()
  })
})
