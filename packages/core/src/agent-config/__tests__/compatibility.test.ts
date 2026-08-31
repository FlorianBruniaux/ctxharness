import { afterEach, describe, expect, it } from 'vitest'
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { inventoryAgentConfig } from '../inventory.js'
import { checkAgentConfigParity } from '../parity.js'
import { validateAgentConfigRelease } from '../release.js'
import {
  scanAgentConfig,
  scanAgents,
  scanHooks,
  scanInstructions,
  scanMcp,
  scanRules,
  scanSkills,
} from '../../scanners/index.js'

const FIXTURES = join(import.meta.dirname, '..', '__fixtures__')
const CLAUDE_PROJECT = join(FIXTURES, 'claude-project')
const CODEX_PROJECT = join(FIXTURES, 'codex-project')
const GLOBAL_HOME = join(FIXTURES, 'global-home')
const SHARED_RELEASE = join(FIXTURES, 'shared-release')
const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(directory)
  return directory
}

function installReleaseFixture(): { configRoot: string; releaseRoot: string } {
  const configRoot = makeTempDir('ctxharness-compat-release-')
  const manifest = JSON.parse(
    readFileSync(join(SHARED_RELEASE, 'artifact-manifest.json'), 'utf-8'),
  ) as { releaseId: string }
  const releaseRoot = join(configRoot, 'releases', manifest.releaseId)
  cpSync(join(SHARED_RELEASE, 'outputs'), releaseRoot, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
  })
  copyFileSync(
    join(SHARED_RELEASE, 'artifact-manifest.json'),
    join(releaseRoot, 'artifact-manifest.json'),
  )
  symlinkSync(join('releases', manifest.releaseId), join(configRoot, 'current'))
  return { configRoot, releaseRoot }
}

function installLiveFixture(home: string, releaseRoot: string): void {
  mkdirSync(join(home, '.claude'), { recursive: true })
  mkdirSync(join(home, '.codex'), { recursive: true })
  mkdirSync(join(home, '.agents', 'skills'), { recursive: true })
  copyFileSync(join(releaseRoot, 'claude', 'CLAUDE.md'), join(home, '.claude', 'CLAUDE.md'))
  copyFileSync(join(releaseRoot, 'codex', 'AGENTS.md'), join(home, '.codex', 'AGENTS.md'))
  symlinkSync(join(releaseRoot, 'skills', 'projections', 'claude'), join(home, '.claude', 'skills'))
  symlinkSync(
    join(releaseRoot, 'skills', 'projections', 'codex', 'portable-demo'),
    join(home, '.agents', 'skills', 'portable-demo'),
  )
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('agent configuration compatibility fixtures', () => {
  it('runs every agent configuration scanner against the Claude fixture', () => {
    const inventory = inventoryAgentConfig({
      root: CLAUDE_PROJECT,
      home: GLOBAL_HOME,
      hosts: ['claude'],
      scopes: ['project', 'global'],
    })
    const scannerResults = [
      scanInstructions(inventory),
      scanSkills(inventory),
      scanRules(inventory),
      scanAgents(inventory),
      scanHooks(inventory),
      scanMcp(inventory),
    ]
    const findings = scanAgentConfig(inventory)

    expect(scannerResults.every((result) => result.length > 0)).toBe(true)
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'instruction-valid', status: 'pass' }),
        expect.objectContaining({ code: 'skill-name-collision', status: 'fail' }),
        expect.objectContaining({ code: 'claude-rule-valid', status: 'pass' }),
        expect.objectContaining({ code: 'agent-valid', status: 'pass' }),
        expect.objectContaining({ code: 'hook-command-unresolved', status: 'fail' }),
        expect.objectContaining({
          code: 'hook-command-unverified',
          status: 'unknown',
          reason: 'missing-evidence',
        }),
        expect.objectContaining({ code: 'mcp-literal-secret', status: 'fail' }),
        expect.objectContaining({
          code: 'mcp-config-valid',
          status: 'pass',
          server: 'placeholder',
        }),
      ]),
    )
    expect(JSON.stringify(findings)).not.toContain('claude-fixture-literal-secret')
  })

  it('keeps native and legacy Codex skill roots as distinct provenance', () => {
    const inventory = inventoryAgentConfig({
      root: CODEX_PROJECT,
      home: GLOBAL_HOME,
      hosts: ['codex'],
      scopes: ['project', 'global'],
    })
    const duplicate = inventory.skills.find(
      (skill) => skill.host === 'codex' && skill.name === 'duplicate-review',
    )
    const findings = scanAgentConfig(inventory)

    expect(duplicate?.evidence.map((item) => item.root)).toEqual(
      expect.arrayContaining([
        join(CODEX_PROJECT, '.agents', 'skills'),
        join(CODEX_PROJECT, '.codex', 'skills'),
        join(GLOBAL_HOME, '.agents', 'skills'),
      ]),
    )
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'instruction-valid', status: 'pass' }),
        expect.objectContaining({ code: 'skill-name-collision', status: 'fail' }),
        expect.objectContaining({ code: 'agent-valid', status: 'pass' }),
        expect.objectContaining({ code: 'hook-command-unresolved', status: 'fail' }),
        expect.objectContaining({
          code: 'hook-command-unverified',
          status: 'unknown',
          reason: 'missing-evidence',
        }),
        expect.objectContaining({ code: 'mcp-literal-secret', status: 'fail' }),
        expect.objectContaining({
          code: 'mcp-config-valid',
          status: 'pass',
          server: 'placeholder',
        }),
      ]),
    )
    expect(JSON.stringify(findings)).not.toContain('codex-fixture-literal-secret')
  })

  it('validates a clean shared release and reports a host-specific agent field exception as N/A', () => {
    const { configRoot, releaseRoot } = installReleaseFixture()
    const home = makeTempDir('ctxharness-compat-live-')
    installLiveFixture(home, releaseRoot)

    const validation = validateAgentConfigRelease({ configRoot })
    expect(validation.release, JSON.stringify(validation.findings, null, 2)).toBeDefined()
    const secondInstall = installReleaseFixture()
    const secondValidation = validateAgentConfigRelease({
      configRoot: secondInstall.configRoot,
    })
    expect(secondValidation.release?.manifest.releaseId).toBe(
      validation.release?.manifest.releaseId,
    )
    const findings = checkAgentConfigParity({
      release: validation.release!,
      home,
      policy: { undeclaredDivergence: 'fail' },
    })

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'host-exception-declared',
        status: 'not-applicable',
        message: 'The release namespace declares this capability unsupported for the host.',
        host: 'codex',
        layer: 'agents',
        capability: 'reviewer.permissionMode',
      }),
    )
    expect(findings).not.toContainEqual(
      expect.objectContaining({
        status: 'pass',
        host: 'codex',
        layer: 'agents',
        capability: 'reviewer.permissionMode',
      }),
    )
  })

  it('uses fixture mutations for changed-live and stale-release evidence', () => {
    const { configRoot, releaseRoot } = installReleaseFixture()
    const home = makeTempDir('ctxharness-compat-live-')
    installLiveFixture(home, releaseRoot)
    const validation = validateAgentConfigRelease({ configRoot })
    expect(validation.release, JSON.stringify(validation.findings, null, 2)).toBeDefined()

    copyFileSync(
      join(SHARED_RELEASE, 'mutations', 'changed-live-AGENTS.md'),
      join(home, '.codex', 'AGENTS.md'),
    )
    expect(
      checkAgentConfigParity({
        release: validation.release!,
        home,
        policy: { undeclaredDivergence: 'fail' },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: 'live-output-divergence',
        status: 'fail',
        host: 'codex',
        layer: 'instructions',
      }),
    )

    copyFileSync(
      join(SHARED_RELEASE, 'mutations', 'stale-release-CLAUDE.md'),
      join(releaseRoot, 'claude', 'CLAUDE.md'),
    )
    expect(
      checkAgentConfigParity({
        release: validation.release!,
        home,
        policy: { undeclaredDivergence: 'fail' },
      }),
    ).toEqual([
      expect.objectContaining({
        code: 'release-evidence-stale',
        status: 'unknown',
        reason: 'missing-evidence',
      }),
    ])
  })
})
