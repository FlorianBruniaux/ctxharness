import { mkdtempSync, mkdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'

const cliPath = fileURLToPath(new URL('../../dist/index.js', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const compatibilityFixtures = join(repositoryRoot, 'packages/core/src/agent-config/__fixtures__')

beforeAll(() => {
  const compiler = join(repositoryRoot, 'node_modules', '.bin', 'tsc')
  for (const project of ['packages/core/tsconfig.json', 'packages/cli/tsconfig.json']) {
    const result = spawnSync(compiler, ['-p', project], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })
    if (result.status !== 0) {
      throw new Error(
        `CLI integration build failed for ${project}:\n${result.stdout}${result.stderr}`,
      )
    }
  }
})

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

function invoke(
  cwd: string,
  home: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, NO_COLOR: '1' }
  delete env.FORCE_COLOR
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env,
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('doctor agent configuration mode', () => {
  it.each([
    { command: 'run', args: ['run', '--no-trend'], output: /All 1 assertion passed/u },
    { command: 'check', args: ['check', '--no-trend'], output: /All 1 assertion passed/u },
    { command: 'score', args: ['score', '--no-trend'], output: /Context Health Score/u },
    { command: 'fix', args: ['fix'], output: /Nothing to fix/u },
    {
      command: 'doctor',
      args: ['doctor', '--host', 'claude', '--scope', 'project', '--format', 'json'],
      output: /"mode": "agent-config"/u,
    },
    { command: 'init', args: ['init'], output: /Created \.ctxharness\.yml/u, withoutConfig: true },
    { command: 'snapshot', args: ['snapshot'], output: /Snapshot saved:/u },
    { command: 'diff', args: ['diff'], output: /Snapshot diff/u, needsSnapshot: true },
    {
      command: 'scan',
      args: ['scan', 'AGENTS.md', '--exit-zero'],
      output: /Scanning AGENTS\.md for verifiable claims/u,
    },
    { command: 'trend', args: ['trend', '--project', 'fixture'], output: /No trend history/u },
    { command: 'populate', args: ['populate'], output: /already covered/u },
  ])(
    'runs the existing $command command against a safe local fixture',
    ({ args, output, withoutConfig, needsSnapshot }) => {
      const root = makeTempDir('ctxharness-command-root-')
      const home = makeTempDir('ctxharness-command-home-')
      write(join(root, 'AGENTS.md'), 'This fixture records stable behavior.\n')

      if (withoutConfig !== true) {
        write(
          join(root, '.ctxharness.yml'),
          [
            'version: 1',
            'files:',
            "  include: ['AGENTS.md']",
            'assertions:',
            '  - id: stable-fixture',
            '    extractor: constant',
            '    extractorArgs:',
            '      value: stable',
            '    scanner: literalInMd',
            '    scannerArgs:',
            '      literal: stable',
            '',
          ].join('\n'),
        )
      }
      if (needsSnapshot === true) {
        const snapshot = invoke(root, home, ['snapshot'])
        expect(snapshot.status).toBe(0)
        expect(snapshot.stderr).toBe('')
      }

      const result = invoke(root, home, args)

      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toMatch(output)
      expect(`${result.stdout}${result.stderr}`).not.toMatch(
        /(?:TypeError|ReferenceError|UnhandledPromiseRejection)/u,
      )
    },
  )

  it('keeps untrusted hooks and unresolved placeholders UNKNOWN from fixture evidence', () => {
    const root = makeTempDir('ctxharness-doctor-root-')
    const home = makeTempDir('ctxharness-doctor-home-')
    const evidencePath = join(compatibilityFixtures, 'global-home', 'runtime-evidence.json')

    const result = invoke(root, home, [
      'doctor',
      '--host',
      'both',
      '--scope',
      'both',
      '--format',
      'json',
      '--runtime-evidence',
      evidencePath,
    ])

    expect(result.status).toBe(0)
    const payload = JSON.parse(result.stdout) as {
      findings: Array<{
        source: string
        capability?: string
        status: string
        reason?: string
      }>
    }
    expect(payload.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'runtime',
          capability: 'hook-trust',
          status: 'unknown',
          reason: 'missing-evidence',
        }),
        expect.objectContaining({
          source: 'runtime',
          capability: 'mcp-placeholder-resolution',
          status: 'unknown',
          reason: 'missing-evidence',
        }),
      ]),
    )
  })

  it('selects hosts and scopes and keeps UNKNOWN visible in JSON', () => {
    const root = makeTempDir('ctxharness-doctor-root-')
    const home = makeTempDir('ctxharness-doctor-home-')

    const result = invoke(root, home, [
      'doctor',
      '--host',
      'claude',
      '--scope',
      'global',
      '--format',
      'json',
    ])

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    const payload = JSON.parse(result.stdout) as {
      mode: string
      selection: { hosts: string[]; scopes: string[] }
      summary: { unknown: number; mandatoryFailures: number }
      findings: Array<{ status: string; host?: string; scope?: string }>
    }
    expect(payload.mode).toBe('agent-config')
    expect(payload.selection).toEqual({ hosts: ['claude'], scopes: ['global'] })
    expect(payload.summary.unknown).toBeGreaterThan(0)
    expect(payload.summary.mandatoryFailures).toBe(0)
    expect(payload.findings.some((finding) => finding.status === 'unknown')).toBe(true)
    expect(
      payload.findings.every((finding) => finding.host === undefined || finding.host === 'claude'),
    ).toBe(true)
    expect(
      payload.findings.every(
        (finding) => finding.scope === undefined || finding.scope === 'global',
      ),
    ).toBe(true)
  })

  it('reports timestamped runtime evidence separately and never fails for N/A', () => {
    const root = makeTempDir('ctxharness-doctor-root-')
    const home = makeTempDir('ctxharness-doctor-home-')
    const evidencePath = join(root, 'runtime-evidence.json')
    write(
      evidencePath,
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: '2026-08-31T12:00:00.000Z',
        results: [
          {
            host: 'claude',
            scope: 'project',
            capability: 'prompt-hook',
            status: 'pass',
            message: 'Canary observed.',
          },
          {
            host: 'codex',
            scope: 'project',
            capability: 'prompt-hook',
            status: 'unknown',
            message: 'Client not exercised.',
          },
          {
            host: 'codex',
            scope: 'project',
            capability: 'unsupported-event',
            status: 'not-applicable',
            message: 'Declared host exception.',
          },
        ],
      }),
    )

    const result = invoke(root, home, [
      'doctor',
      '--host',
      'both',
      '--scope',
      'both',
      '--format',
      'json',
      '--runtime-evidence',
      evidencePath,
    ])

    expect(result.status).toBe(0)
    const payload = JSON.parse(result.stdout) as {
      runtimeEvidence: { kind: string; generatedAt: string }
      summary: { notApplicable: number; unknown: number }
      findings: Array<{ source: string; status: string; capability?: string }>
    }
    expect(payload.runtimeEvidence).toEqual(
      expect.objectContaining({
        kind: 'timestamped',
        generatedAt: '2026-08-31T12:00:00.000Z',
      }),
    )
    expect(payload.summary.notApplicable).toBe(1)
    expect(payload.summary.unknown).toBeGreaterThan(0)
    expect(payload.findings).toContainEqual(
      expect.objectContaining({
        source: 'runtime',
        status: 'not-applicable',
        capability: 'unsupported-event',
      }),
    )
  })

  it('does not let runtime evidence declare its own failure mandatory', () => {
    const root = makeTempDir('ctxharness-doctor-root-')
    const home = makeTempDir('ctxharness-doctor-home-')
    const optionalPath = join(root, 'optional.json')
    const selfDeclaredMandatoryPath = join(root, 'self-declared-mandatory.json')
    const base = {
      schemaVersion: 1,
      generatedAt: '2026-08-31T12:00:00.000Z',
    }
    write(
      optionalPath,
      JSON.stringify({
        ...base,
        results: [
          {
            host: 'claude',
            scope: 'project',
            capability: 'optional-canary',
            status: 'fail',
            mandatory: false,
            message: 'Optional canary failed.',
          },
        ],
      }),
    )
    write(
      selfDeclaredMandatoryPath,
      JSON.stringify({
        ...base,
        results: [
          {
            host: 'claude',
            scope: 'project',
            capability: 'mandatory-canary',
            status: 'fail',
            mandatory: true,
            message: 'Mandatory canary failed.',
          },
        ],
      }),
    )

    const optional = invoke(root, home, [
      'doctor',
      '--host',
      'claude',
      '--scope',
      'project',
      '--format',
      'json',
      '--runtime-evidence',
      optionalPath,
    ])
    const selfDeclaredMandatory = invoke(root, home, [
      'doctor',
      '--host',
      'claude',
      '--scope',
      'project',
      '--format',
      'json',
      '--runtime-evidence',
      selfDeclaredMandatoryPath,
    ])

    expect(optional.status).toBe(0)
    expect(JSON.parse(optional.stdout).summary.mandatoryFailures).toBe(0)
    expect(selfDeclaredMandatory.status).toBe(0)
    const payload = JSON.parse(selfDeclaredMandatory.stdout) as {
      summary: { mandatoryFailures: number }
      findings: Array<{ source: string; capability?: string; mandatory: boolean }>
    }
    expect(payload.summary.mandatoryFailures).toBe(0)
    expect(payload.findings).toContainEqual(
      expect.objectContaining({
        source: 'runtime',
        capability: 'mandatory-canary',
        mandatory: false,
      }),
    )
  })

  it('flushes a large JSON report before returning a mandatory failure', () => {
    const root = makeTempDir('ctxharness-doctor-root-')
    const home = makeTempDir('ctxharness-doctor-home-')
    const evidencePath = join(root, 'runtime-evidence.json')
    const results = Array.from({ length: 3_000 }, (_, index) => ({
      host: 'claude',
      scope: 'project',
      capability: `canary-${index}`,
      status: 'pass',
      message: `Observed canary ${index}: ${'x'.repeat(80)}`,
    }))
    write(
      evidencePath,
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: '2026-08-31T12:00:00.000Z',
        results,
      }),
    )
    write(join(root, '.claude', 'skills', 'invalid', 'SKILL.md'), '# missing frontmatter')

    const result = invoke(root, home, [
      'doctor',
      '--host',
      'claude',
      '--scope',
      'project',
      '--format',
      'json',
      '--runtime-evidence',
      evidencePath,
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toBe('')
    const payload = JSON.parse(result.stdout) as {
      summary: { mandatoryFailures: number }
      findings: Array<{ capability?: string }>
    }
    expect(payload.summary.mandatoryFailures).toBeGreaterThan(0)
    expect(payload.findings).toContainEqual(expect.objectContaining({ capability: 'canary-2999' }))
  })

  it('rejects oversized runtime evidence from file metadata before reading it', () => {
    const root = makeTempDir('ctxharness-doctor-root-')
    const home = makeTempDir('ctxharness-doctor-home-')
    const evidencePath = join(root, 'runtime-evidence.json')
    try {
      write(evidencePath, '')
      truncateSync(evidencePath, 2 ** 32)

      const result = invoke(root, home, [
        'doctor',
        '--host',
        'claude',
        '--scope',
        'project',
        '--format',
        'json',
        '--runtime-evidence',
        evidencePath,
      ])

      expect(result.status).toBe(0)
      const payload = JSON.parse(result.stdout) as {
        findings: Array<{ code: string; message: string }>
      }
      expect(payload.findings).toContainEqual(
        expect.objectContaining({
          code: 'runtime-evidence-unavailable',
          message: 'Runtime evidence exceeds the 1 MB local input limit.',
        }),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('treats a static configuration failure as mandatory', () => {
    const root = makeTempDir('ctxharness-doctor-root-')
    const home = makeTempDir('ctxharness-doctor-home-')
    write(join(root, '.claude', 'skills', 'invalid', 'SKILL.md'), '# missing frontmatter')

    const result = invoke(root, home, [
      'doctor',
      '--host',
      'claude',
      '--scope',
      'project',
      '--format',
      'json',
    ])

    expect(result.status).toBe(1)
    const payload = JSON.parse(result.stdout) as {
      summary: { mandatoryFailures: number }
      findings: Array<{ code: string; status: string; mandatory: boolean }>
    }
    expect(payload.summary.mandatoryFailures).toBeGreaterThan(0)
    expect(payload.findings).toContainEqual(
      expect.objectContaining({ code: 'skill-invalid', status: 'fail', mandatory: true }),
    )
  })

  it('renders UNKNOWN and N/A in human and GitHub Actions formats', () => {
    const root = makeTempDir('ctxharness-doctor-root-')
    const home = makeTempDir('ctxharness-doctor-home-')
    const evidencePath = join(root, 'runtime-evidence.json')
    write(
      evidencePath,
      JSON.stringify({
        schemaVersion: 1,
        signature: { algorithm: 'test', keyId: 'fixture', value: 'signed-fixture' },
        results: [
          {
            host: 'claude',
            scope: 'project',
            capability: 'canary-a',
            status: 'unknown',
            message: 'No observation.',
          },
          {
            host: 'claude',
            scope: 'project',
            capability: 'canary-b',
            status: 'not-applicable',
            message: 'Unsupported.',
          },
        ],
      }),
    )

    const human = invoke(root, home, [
      'doctor',
      '--host',
      'claude',
      '--scope',
      'project',
      '--format',
      'human',
      '--runtime-evidence',
      evidencePath,
    ])
    const gha = invoke(root, home, [
      'doctor',
      '--host',
      'claude',
      '--scope',
      'project',
      '--format',
      'gha',
      '--runtime-evidence',
      evidencePath,
    ])

    expect(human.status).toBe(0)
    expect(human.stdout).toContain('[UNKNOWN]')
    expect(human.stdout).toContain('[N/A]')
    expect(gha.status).toBe(0)
    expect(gha.stdout).toContain('title=UNKNOWN')
    expect(gha.stdout).toContain('title=N/A')
  })

  it('preserves the existing doctor report when new flags are absent', () => {
    const root = makeTempDir('ctxharness-doctor-root-')
    const home = makeTempDir('ctxharness-doctor-home-')
    write(
      join(root, '.ctxharness.yml'),
      [
        'version: 1',
        'files:',
        '  include: []',
        'assertions:',
        '  - id: legacy',
        '    extractor: constant',
        '    extractorArgs:',
        '      value: ok',
        '    scanner: literalInMd',
        '',
      ].join('\n'),
    )

    const result = invoke(root, home, ['doctor'])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Context Assembly Report')
    expect(result.stdout).not.toContain('agent-config')
  })
})
