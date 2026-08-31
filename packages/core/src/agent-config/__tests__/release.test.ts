import { afterEach, describe, expect, it } from 'vitest'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { validateAgentConfigRelease } from '../release.js'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'shared-release')
const VALID_RELEASE_ID = 'b54b1551a232c578315e3580adc75b4bcbca27bba0ac6b2d36893f59b404de8b'
const tempDirs: string[] = []

function makeTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'ctxharness-release-'))
  tempDirs.push(directory)
  return directory
}

function writeFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents, 'utf-8')
}

function writeRelease(release: string): void {
  const manifestPath = join(FIXTURE, 'manifest-valid.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
    artifacts: Record<string, { type: 'file' | 'symlink'; linkTarget?: string }>
  }
  mkdirSync(release, { recursive: true })
  for (const [path, artifact] of Object.entries(manifest.artifacts)) {
    const target = join(release, path)
    mkdirSync(dirname(target), { recursive: true })
    if (artifact.type === 'symlink') symlinkSync(artifact.linkTarget!, target)
    else copyFileSync(join(FIXTURE, 'outputs', path), target)
  }
  copyFileSync(manifestPath, join(release, 'artifact-manifest.json'))
}

function installFixture(configRoot: string, releaseId = VALID_RELEASE_ID): string {
  const release = join(configRoot, 'releases', releaseId)
  writeRelease(release)
  symlinkSync(join('releases', releaseId), join(configRoot, 'current'))
  return release
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('validateAgentConfigRelease', () => {
  it.each([0o600, 0o666, 0o777])(
    'rejects artifact mode %s when the manifest declares 0644',
    (mode) => {
      const configRoot = makeTempDir()
      const release = installFixture(configRoot)
      const output = join(release, 'claude', 'CLAUDE.md')
      const expectedOutput = join(realpathSync(release), 'claude', 'CLAUDE.md')
      chmodSync(output, mode)

      const result = validateAgentConfigRelease({ configRoot })

      expect(result.release).toBeUndefined()
      expect(result.findings).toContainEqual(
        expect.objectContaining({
          code: 'release-output-hash-mismatch',
          status: 'fail',
          path: expectedOutput,
        }),
      )
    },
  )

  it('selects a contained immutable release and recomputes its manifest and output hashes', () => {
    const configRoot = makeTempDir()
    const release = installFixture(configRoot)

    const result = validateAgentConfigRelease({ configRoot })

    expect(result.release).toEqual(
      expect.objectContaining({
        root: realpathSync(release),
        manifestPath: join(realpathSync(release), 'artifact-manifest.json'),
        manifest: expect.objectContaining({ releaseId: VALID_RELEASE_ID }),
      }),
    )
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'current-release-valid', status: 'pass' }),
        expect.objectContaining({
          code: 'release-identity-valid',
          status: 'pass',
          expected: VALID_RELEASE_ID,
          observed: VALID_RELEASE_ID,
        }),
        expect.objectContaining({
          code: 'release-output-hash-valid',
          status: 'pass',
          path: join(realpathSync(release), 'claude', 'CLAUDE.md'),
          observed: '878fc82da40ac3504a373c1c2a842f89888a7c1c8ac43bbec7e90cd48ae58bd5',
        }),
      ]),
    )
  })

  it('fails closed when current resolves outside the selected configuration boundary', () => {
    const configRoot = makeTempDir()
    const outside = makeTempDir()
    writeFile(join(outside, 'manifest.json'), 'outside-secret-value')
    symlinkSync(outside, join(configRoot, 'current'))

    const result = validateAgentConfigRelease({ configRoot })
    const serialized = JSON.stringify(result)

    expect(result.release).toBeUndefined()
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'current-release-outside-boundary',
        status: 'fail',
        reason: 'outside-boundary',
      }),
    )
    expect(serialized).not.toContain('outside-secret-value')
  })

  it('does not follow a releases directory symlink outside the selected configuration boundary', () => {
    const configRoot = makeTempDir()
    const outsideReleases = makeTempDir()
    const release = join(outsideReleases, VALID_RELEASE_ID)
    writeRelease(release)
    writeFile(join(release, 'unlisted.txt'), 'outside-release-secret-value')
    symlinkSync(outsideReleases, join(configRoot, 'releases'))
    symlinkSync(join('releases', VALID_RELEASE_ID), join(configRoot, 'current'))

    const result = validateAgentConfigRelease({ configRoot })
    const serialized = JSON.stringify(result)

    expect(result.release).toBeUndefined()
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'current-release-outside-boundary',
        status: 'fail',
        reason: 'outside-boundary',
      }),
    )
    expect(serialized).not.toContain('outside-release-secret-value')
  })

  it('rejects a release directory whose name is not the recomputed canonical manifest identity', () => {
    const configRoot = makeTempDir()
    const wrongReleaseId = '0'.repeat(64)
    installFixture(configRoot, wrongReleaseId)

    const result = validateAgentConfigRelease({ configRoot })

    expect(result.release).toBeUndefined()
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'release-identity-mismatch',
        status: 'fail',
        expected: wrongReleaseId,
        observed: VALID_RELEASE_ID,
      }),
    )
  })

  it('rejects changed release output without exposing its contents', () => {
    const configRoot = makeTempDir()
    const release = installFixture(configRoot)
    writeFile(join(release, 'claude', 'CLAUDE.md'), 'fixture-secret-changed')

    const result = validateAgentConfigRelease({ configRoot })
    const serialized = JSON.stringify(result)

    expect(result.release).toBeUndefined()
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'release-output-hash-mismatch',
        status: 'fail',
        path: join(realpathSync(release), 'claude', 'CLAUDE.md'),
      }),
    )
    expect(serialized).not.toContain('fixture-secret-changed')
  })

  it('does not follow a declared output symlink outside the selected release', () => {
    const configRoot = makeTempDir()
    const release = installFixture(configRoot)
    const outside = makeTempDir()
    const output = join(release, 'claude', 'CLAUDE.md')
    writeFile(join(outside, 'escaped.md'), 'fixture-secret-outside-release')
    rmSync(output)
    symlinkSync(join(outside, 'escaped.md'), output)

    const result = validateAgentConfigRelease({ configRoot })
    const serialized = JSON.stringify(result)

    expect(result.release).toBeUndefined()
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'release-output-outside-boundary',
        status: 'fail',
        reason: 'outside-boundary',
      }),
    )
    expect(serialized).not.toContain('fixture-secret-outside-release')
  })

  it('keeps a missing current target unknown instead of treating it as success', () => {
    const configRoot = makeTempDir()
    mkdirSync(join(configRoot, 'releases'), { recursive: true })
    symlinkSync(join('releases', VALID_RELEASE_ID), join(configRoot, 'current'))

    const result = validateAgentConfigRelease({ configRoot })

    expect(result.release).toBeUndefined()
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'current-release-unavailable',
        status: 'unknown',
        reason: 'missing-evidence',
      }),
    )
  })
})
