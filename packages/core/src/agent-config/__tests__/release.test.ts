import { afterEach, describe, expect, it } from 'vitest'
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { validateAgentConfigRelease } from '../release.js'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'shared-release')
const VALID_MANIFEST_HASH = '1bd9f57d5c5b5adfc155c505502e9afce5777cb5929044d9b7298012ca521173'
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

function installFixture(configRoot: string, manifestHash = VALID_MANIFEST_HASH): string {
  const release = join(configRoot, 'releases', manifestHash)
  mkdirSync(release, { recursive: true })
  cpSync(join(FIXTURE, 'outputs'), release, { recursive: true })
  copyFileSync(join(FIXTURE, 'manifest-valid.json'), join(release, 'manifest.json'))
  symlinkSync(join('releases', manifestHash), join(configRoot, 'current'))
  return release
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('validateAgentConfigRelease', () => {
  it('selects a contained immutable release and recomputes its manifest and output hashes', () => {
    const configRoot = makeTempDir()
    const release = installFixture(configRoot)

    const result = validateAgentConfigRelease({ configRoot })

    expect(result.release).toEqual(
      expect.objectContaining({
        root: realpathSync(release),
        manifestPath: join(realpathSync(release), 'manifest.json'),
        manifestHash: VALID_MANIFEST_HASH,
      }),
    )
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'current-release-valid', status: 'pass' }),
        expect.objectContaining({
          code: 'release-manifest-hash-valid',
          status: 'pass',
          expected: VALID_MANIFEST_HASH,
          observed: VALID_MANIFEST_HASH,
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
    const release = join(outsideReleases, VALID_MANIFEST_HASH)
    mkdirSync(release, { recursive: true })
    cpSync(join(FIXTURE, 'outputs'), release, { recursive: true })
    copyFileSync(join(FIXTURE, 'manifest-valid.json'), join(release, 'manifest.json'))
    writeFile(join(release, 'unlisted.txt'), 'outside-release-secret-value')
    symlinkSync(outsideReleases, join(configRoot, 'releases'))
    symlinkSync(join('releases', VALID_MANIFEST_HASH), join(configRoot, 'current'))

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

  it('rejects a release directory whose name is not the recomputed manifest hash', () => {
    const configRoot = makeTempDir()
    const wrongHash = '0'.repeat(64)
    installFixture(configRoot, wrongHash)

    const result = validateAgentConfigRelease({ configRoot })

    expect(result.release).toBeUndefined()
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'release-manifest-hash-mismatch',
        status: 'fail',
        expected: wrongHash,
        observed: VALID_MANIFEST_HASH,
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
    symlinkSync(join('releases', VALID_MANIFEST_HASH), join(configRoot, 'current'))

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
