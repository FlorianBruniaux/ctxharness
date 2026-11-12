import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const cli = join(repositoryRoot, 'packages/cli/dist/index.js')
let base: string, root: string, home: string, artifacts: string
beforeAll(() => {
  const compiler = join(repositoryRoot, 'node_modules/.bin/tsc')
  for (const project of ['packages/core/tsconfig.json', 'packages/cli/tsconfig.json']) {
    const result = spawnSync(compiler, ['-p', project], { cwd: repositoryRoot, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stdout + result.stderr)
  }
}, 120_000)
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'ctx-a2-cli-'))
  root = join(base, 'project')
  home = join(base, 'home')
  artifacts = join(base, 'artifacts')
  for (const path of [root, home, artifacts]) mkdirSync(path)
})
afterEach(() => rmSync(base, { recursive: true, force: true }))
function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
function invoke(args: string[], cwd = root) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, HOME: home, NO_COLOR: '1' },
    encoding: 'utf8',
    timeout: 15_000,
  })
}
function contract(expectations: unknown[]) {
  const path = join(artifacts, 'expect.json')
  write(path, JSON.stringify({ schemaVersion: 1, host: 'claude', scope: 'project', expectations }))
  return path
}
const file = (state: 'present' | 'absent', path = '.claude/rules/design.md') => ({
  id: 'design-rule',
  kind: 'file',
  path,
  state,
})
function doctor(path: string, more: string[] = []) {
  return invoke([
    'doctor',
    '--host',
    'claude',
    '--scope',
    'project',
    '--expect',
    path,
    '--format',
    'json',
    ...more,
  ])
}
function tree(path: string): Record<string, string> {
  const result: Record<string, string> = {}
  function walk(dir: string, prefix: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = prefix + entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), name + '/')
      else result[name] = readFileSync(join(dir, entry.name)).toString('base64')
    }
  }
  walk(path, '')
  return result
}

describe('doctor explicit expectations', () => {
  it('passes explicit absences despite unrelated inventory unknowns', () => {
    const result = doctor(contract([file('absent')]))
    expect(result.status).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report.summary.unknown).toBeGreaterThan(0)
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: 'config-expectations-satisfied', status: 'pass' }),
    )
    expect(report.findings).toContainEqual(
      expect.objectContaining({ capability: 'design-rule', status: 'pass' }),
    )
  })
  it('blocks an unknown expectation without concealing the unknown observation', () => {
    write(join(root, '.mcp.json'), '{}')
    const result = doctor(
      contract([
        {
          id: 'design-mcp',
          kind: 'mcp-server',
          path: '.mcp.json',
          name: 'design_fixture',
          state: 'absent',
        },
      ]),
    )
    expect(result.status).toBe(1)
    const report = JSON.parse(result.stdout)
    expect(report.findings).toContainEqual(
      expect.objectContaining({ capability: 'design-mcp', status: 'unknown', mandatory: false }),
    )
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: 'config-expectations-unsatisfied',
        status: 'fail',
        mandatory: true,
      }),
    )
    expect(report.summary.mandatoryFailures).toBe(
      report.findings.filter(
        (f: { status: string; mandatory: boolean }) => f.status === 'fail' && f.mandatory,
      ).length,
    )
  })
  it('does not add expectations to measured coverage or mutate the project', () => {
    write(join(root, 'CLAUDE.md'), 'A stable fixture.\n')
    const path = contract([file('present', 'CLAUDE.md')])
    const before = tree(root)
    const normal = invoke([
      'doctor',
      '--host',
      'claude',
      '--scope',
      'project',
      '--format',
      'json',
      '--coverage',
      '--budget',
    ])
    const checked = doctor(path, ['--coverage', '--budget'])
    expect(checked.status).toBe(0)
    const left = JSON.parse(normal.stdout),
      right = JSON.parse(checked.stdout)
    expect(right.coverage).toEqual(left.coverage)
    expect(right.budget).toEqual(left.budget)
    expect(Object.keys(right).sort()).toEqual(Object.keys(left).sort())
    expect(tree(root)).toEqual(before)
    expect(tree(home)).toEqual({})
  })
  it.each(
    [
      [],
      ['--host', 'claude'],
      ['--host', 'codex', '--scope', 'project'],
      ['--host', 'both', '--scope', 'project'],
      ['--host', 'claude', '--scope', 'both'],
    ].map((args) => ({ args })),
  )('rejects a missing or incompatible explicit selection %#', ({ args }) => {
    const result = invoke(['doctor', '--expect', contract([file('absent')]), ...args])
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
  })
  it('rejects invalid contracts without a success report', () => {
    const path = contract([])
    const result = doctor(path)
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
  })
  it('keeps portable output free of contract identifiers and MCP values', () => {
    const path = contract([
      {
        id: 'PRIVATE_ID',
        kind: 'mcp-server',
        path: '.mcp.json',
        name: 'PRIVATE_SERVER',
        state: 'absent',
      },
    ])
    write(
      join(root, '.mcp.json'),
      JSON.stringify({ mcpServers: { PRIVATE_SERVER: { command: 'PRIVATE_COMMAND' } } }),
    )
    const result = doctor(path, ['--export', 'portable'])
    expect(result.status).toBe(1)
    const report = JSON.parse(result.stdout)
    expect(report.kind).toBe('ctxharness-portable')
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: 'unrecognized-finding', status: 'fail' }),
    )
    expect(result.stdout).not.toContain('PRIVATE')
    expect(result.stdout).not.toContain(root)
  })
  it('keeps default behavior unchanged when no contract is supplied', () => {
    write(join(root, '.mcp.json'), '{}')
    const result = invoke(['doctor', '--host', 'claude', '--scope', 'project', '--format', 'json'])
    expect(result.status).toBe(0)
    expect(
      JSON.parse(result.stdout).findings.some((f: { code: string }) =>
        f.code.startsWith('config-expect'),
      ),
    ).toBe(false)
  })
  it('resolves contract from cwd and targets from root', () => {
    write(join(root, 'CLAUDE.md'), 'inert')
    contract([file('present', 'CLAUDE.md')])
    const result = invoke(
      [
        'doctor',
        '--root',
        root,
        '--host',
        'claude',
        '--scope',
        'project',
        '--expect',
        'expect.json',
        '--format',
        'json',
      ],
      artifacts,
    )
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).root).toBe(root)
  })
  it.each(['human', 'gha'])('renders unmet expectations in %s output', (format) => {
    const result = doctor(contract([file('present')]), ['--format', format])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('FAIL')
    expect(result.stdout).toContain('design-rule')
  })
})

const fixture = join(
  repositoryRoot,
  'packages/core/src/agent-config/__fixtures__/profile-expectations',
)
const managed = [
  'CLAUDE.md',
  '.claude/rules/common.md',
  '.claude/rules/design.md',
  '.mcp.json',
  '.claude/skills/demo/SKILL.md',
  '.claude/skills/demo/references/old.md',
  '.claude/skills/demo/references/new.md',
  'scripts/profile-check.mjs',
]
type Revision = 'A' | 'B'
type Profile = 'backend' | 'frontend'
function mount(revision: Revision, profile: Profile) {
  // Test setup owns only these paths. The existing local override is never rewritten.
  for (const path of managed) rmSync(join(root, path), { force: true })
  const sources = join(fixture, 'sources', revision)
  for (const path of Object.keys(tree(sources)))
    write(join(root, path), readFileSync(join(sources, path), 'utf8'))
  if (profile === 'frontend')
    write(
      join(root, '.claude/rules/design.md'),
      readFileSync(join(fixture, 'frontend/.claude/rules/design.md'), 'utf8'),
    )
  write(
    join(root, '.mcp.json'),
    JSON.stringify({
      mcpServers:
        profile === 'frontend'
          ? { design_fixture: { command: 'node', args: ['scripts/profile-check.mjs'] } }
          : {},
    }),
  )
}
function profileContract(revision: Revision, profile: Profile) {
  return join(fixture, 'contracts', `${revision}-${profile}.json`)
}
function localOverride() {
  write(join(root, '.claude/rules/local.md'), readFileSync(join(fixture, 'local.md'), 'utf8'))
}
function assertContentOracle(revision: Revision) {
  // Expectations are independent of mount's source files and of ctxharness output.
  expect(readFileSync(join(root, '.claude/rules/common.md'), 'utf8')).toBe(
    revision === 'A'
      ? 'Common convention A: validate the input before processing it.\n'
      : 'Common convention B: validate the input before processing it.\n',
  )
  expect(readFileSync(join(root, 'scripts/profile-check.mjs'), 'utf8')).toBe(
    "import { writeFileSync } from 'node:fs'\nwriteFileSync('SHOULD_NEVER_RUN', 'executed')\nconsole.log('" +
      (revision === 'A' ? 'v1' : 'v2') +
      "')\n",
  )
  expect(readFileSync(join(root, '.claude/skills/demo/SKILL.md'), 'utf8')).toBe(
    '---\nname: demo\ndescription: Demonstrate explicit profile expectations.\n---\n\nRead [support](references/' +
      (revision === 'A' ? 'old' : 'new') +
      '.md).\n',
  )
  expect(readFileSync(join(root, '.claude/rules/local.md'), 'utf8')).toBe(
    'Keep the repository-specific naming convention.\n',
  )
  expect(
    readFileSync(
      join(root, `.claude/skills/demo/references/${revision === 'A' ? 'old' : 'new'}.md`),
      'utf8',
    ),
  ).toBe('Stable support bytes across the rename.\n')
}
function snapshot(name: string) {
  const path = join(artifacts, `${name}.json`)
  const result = invoke([
    'config-snapshot',
    '--host',
    'claude',
    '--scope',
    'project',
    '--output',
    path,
  ])
  expect(result.status).toBe(0)
  return path
}

describe('backend/frontend baseline update recipe', () => {
  it('validates four states, round trips, idempotence and A to B at one project root', () => {
    localOverride()
    const originalLocal = readFileSync(join(root, '.claude/rules/local.md'))
    const sequence: [Revision, Profile][] = [
      ['A', 'backend'],
      ['A', 'frontend'],
      ['A', 'backend'],
      ['A', 'backend'],
      ['B', 'backend'],
      ['B', 'frontend'],
      ['B', 'backend'],
      ['A', 'backend'],
    ]
    const snapshots: string[] = []
    let repeatedState: Record<string, string> | undefined
    for (const [index, [revision, profile]] of sequence.entries()) {
      mount(revision, profile)
      const before = tree(root)
      if (index === 2) repeatedState = before
      if (index === 3) expect(before).toEqual(repeatedState)
      const result = doctor(profileContract(revision, profile))
      expect(result.status, result.stdout + result.stderr).toBe(0)
      const report = JSON.parse(result.stdout)
      const checked = report.findings.filter(
        (f: { code: string }) => f.code === 'config-expectation-match',
      )
      expect(checked.map((f: { capability: string }) => f.capability)).toEqual([
        'instructions',
        'common-rule',
        'local-rule',
        'skill',
        'check-script',
        'design-rule',
        'design-mcp',
        'old-support',
        'new-support',
      ])
      expect(report.findings).toContainEqual(
        expect.objectContaining({ code: 'config-expectations-satisfied', status: 'pass' }),
      )
      assertContentOracle(revision)
      expect(readFileSync(join(root, '.claude/rules/local.md'))).toEqual(originalLocal)
      snapshots.push(snapshot(`state-${index}`))
      expect(tree(root)).toEqual(before)
      expect(existsSync(join(root, 'SHOULD_NEVER_RUN'))).toBe(false)
    }
    const identical = invoke(['config-diff', snapshots[2]!, snapshots[3]!])
    expect(identical.status).toBe(0)
    expect(JSON.parse(identical.stdout)).toMatchObject({ status: 'equal', evidence: 'complete' })
    const update = invoke(['config-diff', snapshots[3]!, snapshots[4]!])
    expect(update.status).toBe(0)
    const delta = JSON.parse(update.stdout)
    expect(delta).toMatchObject({ status: 'changed', evidence: 'complete' })
    // Snapshot v1 covers these content changes. The script and ordinary Markdown
    // support link are outside its content coverage and have independent oracles above.
    const contentRef = (path: string) =>
      createHash('sha256')
        .update(JSON.stringify(['content', 'project', path]))
        .digest('hex')
    expect(delta.changes).toHaveLength(2)
    expect(delta.changes).toEqual(
      expect.arrayContaining([
        { kind: 'changed', ref: contentRef('.claude/rules/common.md') },
        { kind: 'changed', ref: contentRef('.claude/skills/demo/SKILL.md') },
      ]),
    )
    const restored = invoke(['config-diff', snapshots[0]!, snapshots[7]!])
    expect(restored.status).toBe(0)
    expect(JSON.parse(restored.stdout)).toMatchObject({ status: 'equal', evidence: 'complete' })
  })
  it.each(['design-rule', 'design-mcp', 'old-support'] as const)(
    'rejects leftover %s and passes after only that residue is removed',
    (kind) => {
      localOverride()
      mount('B', 'backend')
      if (kind === 'design-rule')
        write(join(root, '.claude/rules/design.md'), 'Leftover design convention.\n')
      if (kind === 'design-mcp')
        write(join(root, '.mcp.json'), '{"mcpServers":{"design_fixture":{"command":"never-run"}}}')
      if (kind === 'old-support')
        write(
          join(root, '.claude/skills/demo/references/old.md'),
          'Stable support bytes across the rename.\n',
        )
      const before = tree(root)
      const result = doctor(profileContract('B', 'backend'))
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout).findings).toContainEqual(
        expect.objectContaining({ capability: kind, status: 'fail' }),
      )
      expect(tree(root)).toEqual(before)
      if (kind === 'design-rule') rmSync(join(root, '.claude/rules/design.md'))
      if (kind === 'design-mcp') write(join(root, '.mcp.json'), '{"mcpServers":{}}')
      if (kind === 'old-support') rmSync(join(root, '.claude/skills/demo/references/old.md'))
      expect(doctor(profileContract('B', 'backend')).status).toBe(0)
      assertContentOracle('B')
    },
  )
  it('rejects B when its renamed support is missing', () => {
    localOverride()
    mount('B', 'backend')
    rmSync(join(root, '.claude/skills/demo/references/new.md'))
    const result = doctor(profileContract('B', 'backend'))
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout).findings).toContainEqual(
      expect.objectContaining({ capability: 'new-support', status: 'fail' }),
    )
  })
  it.each([
    '.claude/rules/common.md',
    'scripts/profile-check.mjs',
    '.claude/skills/demo/SKILL.md',
    '.claude/rules/local.md',
  ])('needs the independent content oracle for stale or edited %s', (path) => {
    localOverride()
    mount('B', 'backend')
    write(
      join(root, path),
      path === '.claude/rules/local.md'
        ? 'Unexpected local edit.\n'
        : readFileSync(join(fixture, 'sources/A', path), 'utf8'),
    )
    const result = doctor(profileContract('B', 'backend'))
    const report = JSON.parse(result.stdout)
    // A stale skill reference can independently fail the existing skill scanner.
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: 'config-expectations-satisfied', status: 'pass' }),
    )
    expect(() => assertContentOracle('B')).toThrow()
  })
})

it.each(['fifo', 'oversized'] as const)(
  'reports %s MCP evidence as unavailable before evaluating expectations',
  (kind) => {
    if (kind === 'fifo') expect(spawnSync('mkfifo', [join(root, '.mcp.json')]).status).toBe(0)
    else
      write(
        join(root, '.mcp.json'),
        JSON.stringify({ mcpServers: {}, padding: ' '.repeat(1_000_000) }),
      )
    const ordinary = invoke([
      'doctor',
      '--host',
      'claude',
      '--scope',
      'project',
      '--format',
      'json',
    ])
    expect(ordinary.error).toBeUndefined()
    expect(ordinary.status).toBe(0)
    expect(JSON.parse(ordinary.stdout).findings).toContainEqual(
      expect.objectContaining({
        code: 'mcp-evidence-unavailable',
        status: 'unknown',
        reason: 'missing-evidence',
      }),
    )
    expect(JSON.parse(ordinary.stdout).findings).not.toContainEqual(
      expect.objectContaining({ code: 'mcp-config-invalid' }),
    )
    const result = doctor(
      contract([
        {
          id: 'design-mcp',
          kind: 'mcp-server',
          path: '.mcp.json',
          name: 'design_fixture',
          state: 'absent',
        },
      ]),
    )
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout).findings).toContainEqual(
      expect.objectContaining({ capability: 'design-mcp', status: 'unknown' }),
    )
  },
  20_000,
)

it.each(['CLAUDE.md', '.claude/settings.json', '.claude/skills/demo/SKILL.md'])(
  'does not block before evaluating a required special file at %s',
  (path) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    expect(spawnSync('mkfifo', [join(root, path)]).status).toBe(0)
    const input = contract([{ id: 'special-file', kind: 'file', path, state: 'present' }])
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'doctor',
        '--host',
        'claude',
        '--scope',
        'project',
        '--expect',
        input,
        '--format',
        'json',
        '--coverage',
        '--budget',
      ],
      {
        cwd: root,
        env: { ...process.env, HOME: home, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: 2_000,
      },
    )
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    const report = JSON.parse(result.stdout)
    expect(report.findings).toContainEqual(
      expect.objectContaining({ capability: 'special-file', status: 'unknown' }),
    )
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: 'config-expectations-unsatisfied',
        status: 'fail',
        mandatory: true,
      }),
    )
  },
)
