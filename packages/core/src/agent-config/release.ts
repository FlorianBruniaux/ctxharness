import { lstatSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { isPathWithinBoundary } from './inventory.js'
import type { AgentConfigFinding, AgentConfigLayer, AgentHost } from './types.js'

const SHA256 = /^[a-f0-9]{64}$/
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/
const SAFE_BUILD_VALUE = /^[A-Za-z0-9][A-Za-z0-9._/+:-]{0,127}$/
const OUTPUT_LAYERS = new Set<AgentConfigLayer>([
  'instructions',
  'skills',
  'rules',
  'agents',
  'hooks',
  'mcp',
])

export interface AgentConfigReleaseOutput {
  id: string
  host: AgentHost
  layer: Exclude<AgentConfigLayer, 'release'>
  path: string
  livePath: string
  sha256: string
}

export interface AgentConfigHostException {
  id: string
  host: AgentHost
}

export interface AgentConfigReleaseManifest {
  schemaVersion: 1
  sourceRevision: string
  builderVersion: string
  outputs: AgentConfigReleaseOutput[]
  hostExceptions: AgentConfigHostException[]
}

export interface ValidatedAgentConfigRelease {
  root: string
  manifestPath: string
  manifestHash: string
  manifest: AgentConfigReleaseManifest
}

export interface AgentConfigReleaseResult {
  release?: ValidatedAgentConfigRelease
  findings: AgentConfigFinding[]
}

export interface AgentConfigReleaseOptions {
  /** Boundary containing `current` and the immutable `releases` directory. */
  configRoot: string
}

function hash(contents: Buffer): string {
  return createHash('sha256').update(contents).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeRelativePath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path)) return false
  const normalized = path.replaceAll('\\', '/')
  return !normalized.split('/').some((part) => part === '' || part === '.' || part === '..')
}

function parseHost(value: unknown): AgentHost | null {
  return value === 'claude' || value === 'codex' ? value : null
}

function parseManifest(contents: Buffer): AgentConfigReleaseManifest | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(contents.toString('utf-8'))
  } catch {
    return null
  }
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== 1 ||
    typeof parsed.sourceRevision !== 'string' ||
    !SAFE_BUILD_VALUE.test(parsed.sourceRevision) ||
    typeof parsed.builderVersion !== 'string' ||
    !SAFE_BUILD_VALUE.test(parsed.builderVersion) ||
    !Array.isArray(parsed.outputs) ||
    !Array.isArray(parsed.hostExceptions)
  )
    return null

  const outputs: AgentConfigReleaseOutput[] = []
  const outputKeys = new Set<string>()
  const layersById = new Map<string, AgentConfigReleaseOutput['layer']>()
  for (const value of parsed.outputs) {
    if (!isRecord(value) || !SAFE_ID.test(String(value.id))) return null
    const host = parseHost(value.host)
    if (
      host === null ||
      typeof value.layer !== 'string' ||
      !OUTPUT_LAYERS.has(value.layer as AgentConfigLayer) ||
      !isSafeRelativePath(value.path) ||
      !isSafeRelativePath(value.livePath) ||
      typeof value.sha256 !== 'string' ||
      !SHA256.test(value.sha256)
    )
      return null
    const id = String(value.id)
    const layer = value.layer as AgentConfigReleaseOutput['layer']
    const key = `${id}:${host}`
    const priorLayer = layersById.get(id)
    if (outputKeys.has(key) || (priorLayer !== undefined && priorLayer !== layer)) return null
    outputKeys.add(key)
    layersById.set(id, layer)
    outputs.push({
      id,
      host,
      layer,
      path: value.path,
      livePath: value.livePath,
      sha256: value.sha256,
    })
  }

  const hostExceptions: AgentConfigHostException[] = []
  const exceptionKeys = new Set<string>()
  for (const value of parsed.hostExceptions) {
    if (!isRecord(value) || !SAFE_ID.test(String(value.id))) return null
    const host = parseHost(value.host)
    if (host === null || typeof value.reason !== 'string' || value.reason.length === 0) return null
    const id = String(value.id)
    const key = `${id}:${host}`
    if (exceptionKeys.has(key) || outputKeys.has(key) || !layersById.has(id)) return null
    exceptionKeys.add(key)
    hostExceptions.push({ id, host })
  }

  return {
    schemaVersion: 1,
    sourceRevision: parsed.sourceRevision,
    builderVersion: parsed.builderVersion,
    outputs,
    hostExceptions,
  }
}

function unknown(code: string, message: string, path?: string): AgentConfigFinding {
  return {
    code,
    status: 'unknown',
    reason: 'missing-evidence',
    message,
    layer: 'release',
    ...(path === undefined ? {} : { path }),
  }
}

function boundaryFailure(code: string, message: string, path?: string): AgentConfigFinding {
  return {
    code,
    status: 'fail',
    reason: 'outside-boundary',
    message,
    layer: 'release',
    ...(path === undefined ? {} : { path }),
  }
}

function isDirectRelease(releasesRoot: string, candidate: string): boolean {
  return dirname(candidate) === releasesRoot && SHA256.test(basename(candidate))
}

/**
 * Selects `current`, proves it names a content-addressed release, and hashes
 * every output from disk. File contents never enter findings.
 */
export function validateAgentConfigRelease(
  options: AgentConfigReleaseOptions,
): AgentConfigReleaseResult {
  const configRoot = resolve(options.configRoot)
  const releasesPath = resolve(configRoot, 'releases')
  const currentPath = resolve(configRoot, 'current')
  const findings: AgentConfigFinding[] = []

  let currentStats
  try {
    currentStats = lstatSync(currentPath)
  } catch {
    return {
      findings: [
        unknown(
          'current-release-unavailable',
          'The current release link is unavailable.',
          currentPath,
        ),
      ],
    }
  }
  if (!currentStats.isSymbolicLink()) {
    return {
      findings: [
        {
          code: 'current-release-not-symlink',
          status: 'fail',
          message: 'The current release selector is not a symbolic link.',
          layer: 'release',
          path: currentPath,
        },
      ],
    }
  }

  let targetPath: string
  try {
    targetPath = resolve(dirname(currentPath), readlinkSync(currentPath))
  } catch {
    return {
      findings: [
        unknown(
          'current-release-unavailable',
          'The current release target is unavailable.',
          currentPath,
        ),
      ],
    }
  }
  if (
    !isPathWithinBoundary(configRoot, targetPath) ||
    !isPathWithinBoundary(releasesPath, targetPath)
  ) {
    return {
      findings: [
        boundaryFailure(
          'current-release-outside-boundary',
          'The current release resolves outside the selected configuration boundary.',
          currentPath,
        ),
      ],
    }
  }

  let releasesRoot: string
  let releaseRoot: string
  try {
    const configBoundary = realpathSync(configRoot)
    releasesRoot = realpathSync(releasesPath)
    if (!isPathWithinBoundary(configBoundary, releasesRoot)) {
      return {
        findings: [
          boundaryFailure(
            'current-release-outside-boundary',
            'The releases directory resolves outside the selected configuration boundary.',
            currentPath,
          ),
        ],
      }
    }
    const targetStats = lstatSync(targetPath)
    if (!targetStats.isDirectory()) {
      return {
        findings: [
          {
            code: 'current-release-invalid-target',
            status: 'fail',
            message: 'The current release target is not an immutable release directory.',
            layer: 'release',
            path: currentPath,
          },
        ],
      }
    }
    releaseRoot = realpathSync(targetPath)
  } catch {
    return {
      findings: [
        unknown(
          'current-release-unavailable',
          'The current release target is unavailable.',
          currentPath,
        ),
      ],
    }
  }
  if (
    !isPathWithinBoundary(releasesRoot, releaseRoot) ||
    !isDirectRelease(releasesRoot, releaseRoot)
  ) {
    return {
      findings: [
        boundaryFailure(
          'current-release-outside-boundary',
          'The current release is not a direct content-addressed release directory.',
          currentPath,
        ),
      ],
    }
  }
  findings.push({
    code: 'current-release-valid',
    status: 'pass',
    message: 'The current release selects a contained immutable directory.',
    layer: 'release',
    path: currentPath,
  })

  const manifestPath = resolve(releaseRoot, 'manifest.json')
  let manifestContents: Buffer
  try {
    const resolvedManifest = realpathSync(manifestPath)
    if (
      !isPathWithinBoundary(releaseRoot, resolvedManifest) ||
      !statSync(resolvedManifest).isFile()
    ) {
      return {
        findings: [
          ...findings,
          boundaryFailure(
            'release-manifest-outside-boundary',
            'The release manifest resolves outside the selected release.',
            manifestPath,
          ),
        ],
      }
    }
    manifestContents = readFileSync(resolvedManifest)
  } catch {
    return {
      findings: [
        ...findings,
        unknown(
          'release-manifest-unavailable',
          'The release manifest is unavailable.',
          manifestPath,
        ),
      ],
    }
  }

  const expectedManifestHash = basename(releaseRoot)
  const observedManifestHash = hash(manifestContents)
  if (expectedManifestHash !== observedManifestHash) {
    findings.push({
      code: 'release-manifest-hash-mismatch',
      status: 'fail',
      message: 'The recomputed manifest hash does not match the immutable release directory.',
      layer: 'release',
      path: manifestPath,
      expected: expectedManifestHash,
      observed: observedManifestHash,
    })
    return { findings }
  }
  findings.push({
    code: 'release-manifest-hash-valid',
    status: 'pass',
    message: 'The recomputed manifest hash matches the immutable release directory.',
    layer: 'release',
    path: manifestPath,
    expected: expectedManifestHash,
    observed: observedManifestHash,
  })

  const manifest = parseManifest(manifestContents)
  if (manifest === null) {
    findings.push({
      code: 'release-manifest-invalid',
      status: 'fail',
      message: 'The release manifest does not match the supported schema.',
      layer: 'release',
      path: manifestPath,
    })
    return { findings }
  }

  let valid = true
  for (const output of manifest.outputs) {
    const outputPath = resolve(releaseRoot, output.path)
    if (!isPathWithinBoundary(releaseRoot, outputPath)) {
      valid = false
      findings.push(
        boundaryFailure(
          'release-output-outside-boundary',
          'A declared output resolves outside the selected release.',
        ),
      )
      continue
    }
    let observed: string
    try {
      const resolvedOutput = realpathSync(outputPath)
      if (
        !isPathWithinBoundary(releaseRoot, resolvedOutput) ||
        !statSync(resolvedOutput).isFile()
      ) {
        valid = false
        findings.push(
          boundaryFailure(
            'release-output-outside-boundary',
            'A declared output resolves outside the selected release.',
            outputPath,
          ),
        )
        continue
      }
      observed = hash(readFileSync(resolvedOutput))
    } catch {
      valid = false
      findings.push(
        unknown(
          'release-output-unavailable',
          'A declared release output is unavailable.',
          outputPath,
        ),
      )
      continue
    }
    if (observed !== output.sha256) {
      valid = false
      findings.push({
        code: 'release-output-hash-mismatch',
        status: 'fail',
        message: 'A recomputed release output hash differs from the manifest.',
        host: output.host,
        layer: output.layer,
        path: outputPath,
        capability: output.id,
        expected: output.sha256,
        observed,
      })
      continue
    }
    findings.push({
      code: 'release-output-hash-valid',
      status: 'pass',
      message: 'The recomputed release output hash matches the manifest.',
      host: output.host,
      layer: output.layer,
      path: outputPath,
      capability: output.id,
      expected: output.sha256,
      observed,
    })
  }

  if (!valid) return { findings }
  return {
    release: {
      root: releaseRoot,
      manifestPath,
      manifestHash: observedManifestHash,
      manifest,
    },
    findings,
  }
}
