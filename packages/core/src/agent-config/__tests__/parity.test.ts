import { afterEach, describe, expect, it } from 'vitest'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkAgentConfigParity } from '../parity.js'
import { validateAgentConfigRelease } from '../release.js'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'shared-release')
const VALID_RELEASE_ID = 'b54b1551a232c578315e3580adc75b4bcbca27bba0ac6b2d36893f59b404de8b'
const UNDECLARED_RELEASE_ID = '517274f468af5bcc8d53d83a5ffab5da4d9298364b3f5b04be43bacab76852af'
const tempDirs: string[] = []

function makeTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'ctxharness-parity-'))
  tempDirs.push(directory)
  return directory
}

function writeFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents, 'utf-8')
}

function selectRelease(manifest = 'manifest-valid.json', releaseId = VALID_RELEASE_ID) {
  const configRoot = makeTempDir()
  const release = join(configRoot, 'releases', releaseId)
  const manifestPath = join(FIXTURE, manifest)
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
    artifacts: Record<string, { type: 'file' | 'symlink'; linkTarget?: string }>
  }
  mkdirSync(release, { recursive: true })
  for (const [path, artifact] of Object.entries(parsed.artifacts)) {
    const target = join(release, path)
    mkdirSync(dirname(target), { recursive: true })
    if (artifact.type === 'symlink') symlinkSync(artifact.linkTarget!, target)
    else copyFileSync(join(FIXTURE, 'outputs', path), target)
  }
  copyFileSync(manifestPath, join(release, 'artifact-manifest.json'))
  symlinkSync(join('releases', releaseId), join(configRoot, 'current'))
  const validated = validateAgentConfigRelease({ configRoot })
  expect(validated.release).toBeDefined()
  return validated.release!
}

function installLiveFixture(home: string, releaseRoot: string): void {
  mkdirSync(join(home, '.claude'), { recursive: true })
  mkdirSync(join(home, '.codex'), { recursive: true })
  mkdirSync(join(home, '.agents'), { recursive: true })
  copyFileSync(join(FIXTURE, 'outputs', 'claude', 'CLAUDE.md'), join(home, '.claude', 'CLAUDE.md'))
  copyFileSync(join(FIXTURE, 'outputs', 'codex', 'AGENTS.md'), join(home, '.codex', 'AGENTS.md'))
  symlinkSync(join(releaseRoot, 'skills', 'projections', 'claude'), join(home, '.claude', 'skills'))
  symlinkSync(join(releaseRoot, 'skills', 'projections', 'codex'), join(home, '.agents', 'skills'))
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('checkAgentConfigParity', () => {
  it('compares live instructions and skills with the selected release and reports declared exceptions as N/A', () => {
    const release = selectRelease()
    const home = makeTempDir()
    installLiveFixture(home, release.root)

    const findings = checkAgentConfigParity({
      release,
      home,
      policy: { undeclaredDivergence: 'fail' },
    })

    expect(findings.filter((finding) => finding.code === 'live-output-match')).toHaveLength(5)
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'host-exception-declared',
        status: 'not-applicable',
        host: 'codex',
        layer: 'skills',
        capability: 'claude-helper',
      }),
    )
    expect(findings.some((finding) => finding.code === 'host-parity-divergence')).toBe(false)
  })

  it.each(['warn', 'fail'] as const)(
    'uses the explicit %s policy for changed live output',
    (severity) => {
      const release = selectRelease()
      const home = makeTempDir()
      installLiveFixture(home, release.root)
      writeFile(join(home, '.codex', 'AGENTS.md'), 'fixture-live-secret-divergence')

      const findings = checkAgentConfigParity({
        release,
        home,
        policy: { undeclaredDivergence: severity },
      })
      const serialized = JSON.stringify(findings)

      expect(findings).toContainEqual(
        expect.objectContaining({
          code: 'live-output-divergence',
          status: severity,
          host: 'codex',
          layer: 'instructions',
        }),
      )
      expect(serialized).not.toContain('fixture-live-secret-divergence')
    },
  )

  it.each(['warn', 'fail'] as const)(
    'uses the explicit %s policy for a missing undeclared host projection',
    (severity) => {
      const release = selectRelease('manifest-undeclared.json', UNDECLARED_RELEASE_ID)
      const home = makeTempDir()

      const findings = checkAgentConfigParity({
        release,
        home,
        policy: { undeclaredDivergence: severity },
      })

      expect(findings).toContainEqual(
        expect.objectContaining({
          code: 'host-parity-divergence',
          status: severity,
          host: 'codex',
          layer: 'skills',
          capability: 'review',
        }),
      )
    },
  )

  it('keeps a missing live instruction unknown', () => {
    const release = selectRelease()
    const home = makeTempDir()

    const findings = checkAgentConfigParity({
      release,
      home,
      policy: { undeclaredDivergence: 'fail' },
    })

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'live-output-unavailable',
        status: 'unknown',
        reason: 'missing-evidence',
        host: 'claude',
        layer: 'instructions',
      }),
    )
  })

  it('keeps parity unknown when the selected manifest changed after validation', () => {
    const release = selectRelease()
    const home = makeTempDir()
    installLiveFixture(home, release.root)
    writeFile(release.manifestPath, 'fixture-stale-manifest-secret')

    const findings = checkAgentConfigParity({
      release,
      home,
      policy: { undeclaredDivergence: 'fail' },
    })
    const serialized = JSON.stringify(findings)

    expect(findings).toEqual([
      expect.objectContaining({
        code: 'release-evidence-stale',
        status: 'unknown',
        reason: 'missing-evidence',
        layer: 'release',
      }),
    ])
    expect(serialized).not.toContain('fixture-stale-manifest-secret')
  })

  it('keeps all parity results unknown when a non-live release artifact changes after validation', () => {
    const release = selectRelease()
    const home = makeTempDir()
    installLiveFixture(home, release.root)
    writeFile(join(release.root, 'agents', 'claude', 'reviewer.md'), 'fixture-stale-agent-secret')

    const findings = checkAgentConfigParity({
      release,
      home,
      policy: { undeclaredDivergence: 'fail' },
    })
    const serialized = JSON.stringify(findings)

    expect(findings).toEqual([
      expect.objectContaining({
        code: 'release-evidence-stale',
        status: 'unknown',
        reason: 'missing-evidence',
        layer: 'agents',
        capability: 'reviewer',
      }),
    ])
    expect(serialized).not.toContain('fixture-stale-agent-secret')
    expect(findings.some((finding) => finding.status === 'pass')).toBe(false)
    expect(findings.some((finding) => finding.status === 'not-applicable')).toBe(false)
  })

  it('does not follow a live skill symlink outside the injected home boundary', () => {
    const release = selectRelease()
    const home = makeTempDir()
    const outside = makeTempDir()
    const liveSkill = join(home, '.claude', 'skills', 'review')
    mkdirSync(dirname(liveSkill), { recursive: true })
    writeFile(join(outside, 'SKILL.md'), 'fixture-secret-outside-home')
    symlinkSync(outside, liveSkill)

    const findings = checkAgentConfigParity({
      release,
      home,
      policy: { undeclaredDivergence: 'fail' },
    })
    const serialized = JSON.stringify(findings)

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'live-output-outside-boundary',
        status: 'fail',
        reason: 'outside-boundary',
        host: 'claude',
        layer: 'skills',
      }),
    )
    expect(serialized).not.toContain('fixture-secret-outside-home')
  })
})
