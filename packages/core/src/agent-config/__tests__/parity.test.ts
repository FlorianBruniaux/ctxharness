import { afterEach, describe, expect, it } from 'vitest'
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkAgentConfigParity } from '../parity.js'
import { validateAgentConfigRelease } from '../release.js'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'shared-release')
const VALID_MANIFEST_HASH = '1bd9f57d5c5b5adfc155c505502e9afce5777cb5929044d9b7298012ca521173'
const UNDECLARED_MANIFEST_HASH = '59805e3ef30d959377b404741dc2356e24d480fe6aa89f0c47798f1b5cf7e619'
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

function selectRelease(manifest = 'manifest-valid.json', hash = VALID_MANIFEST_HASH) {
  const configRoot = makeTempDir()
  const release = join(configRoot, 'releases', hash)
  mkdirSync(release, { recursive: true })
  cpSync(join(FIXTURE, 'outputs'), release, { recursive: true })
  copyFileSync(join(FIXTURE, manifest), join(release, 'manifest.json'))
  symlinkSync(join('releases', hash), join(configRoot, 'current'))
  const validated = validateAgentConfigRelease({ configRoot })
  expect(validated.release).toBeDefined()
  return validated.release!
}

function installLiveFixture(home: string): void {
  copyFileSync(join(FIXTURE, 'outputs', 'claude', 'CLAUDE.md'), join(home, '.claude', 'CLAUDE.md'))
  copyFileSync(join(FIXTURE, 'outputs', 'codex', 'AGENTS.md'), join(home, '.codex', 'AGENTS.md'))
  copyFileSync(
    join(FIXTURE, 'outputs', 'claude', 'skills', 'review', 'SKILL.md'),
    join(home, '.claude', 'skills', 'review', 'SKILL.md'),
  )
  copyFileSync(
    join(FIXTURE, 'outputs', 'codex', 'skills', 'review', 'SKILL.md'),
    join(home, '.codex', 'skills', 'review', 'SKILL.md'),
  )
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('checkAgentConfigParity', () => {
  it('compares live instructions and skills with the selected release and reports declared exceptions as N/A', () => {
    const release = selectRelease()
    const home = makeTempDir()
    mkdirSync(join(home, '.claude', 'skills', 'review'), { recursive: true })
    mkdirSync(join(home, '.codex', 'skills', 'review'), { recursive: true })
    installLiveFixture(home)

    const findings = checkAgentConfigParity({
      release,
      home,
      policy: { undeclaredDivergence: 'fail' },
    })

    expect(findings.filter((finding) => finding.code === 'live-output-match')).toHaveLength(4)
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'host-exception-declared',
        status: 'not-applicable',
        host: 'codex',
        layer: 'agents',
        capability: 'reviewer-agent',
      }),
    )
    expect(findings.some((finding) => finding.code === 'host-parity-divergence')).toBe(false)
  })

  it.each(['warn', 'fail'] as const)(
    'uses the explicit %s policy for changed live output',
    (severity) => {
      const release = selectRelease()
      const home = makeTempDir()
      mkdirSync(join(home, '.claude', 'skills', 'review'), { recursive: true })
      mkdirSync(join(home, '.codex', 'skills', 'review'), { recursive: true })
      installLiveFixture(home)
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
      const release = selectRelease('manifest-undeclared.json', UNDECLARED_MANIFEST_HASH)
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
          layer: 'agents',
          capability: 'reviewer-agent',
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
    mkdirSync(join(home, '.claude', 'skills', 'review'), { recursive: true })
    mkdirSync(join(home, '.codex', 'skills', 'review'), { recursive: true })
    installLiveFixture(home)
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

  it('does not follow a live skill symlink outside the injected home boundary', () => {
    const release = selectRelease()
    const home = makeTempDir()
    const outside = makeTempDir()
    const liveSkill = join(home, '.claude', 'skills', 'review', 'SKILL.md')
    mkdirSync(dirname(liveSkill), { recursive: true })
    writeFile(join(outside, 'SKILL.md'), 'fixture-secret-outside-home')
    symlinkSync(join(outside, 'SKILL.md'), liveSkill)

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
