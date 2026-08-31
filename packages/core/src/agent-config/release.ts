import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { isPathWithinBoundary } from './inventory.js'
import type { AgentConfigFinding, AgentConfigLayer, AgentHost } from './types.js'

const SHA256 = /^[a-f0-9]{64}$/

export type AgentConfigReleaseArtifact =
  | { type: 'file'; hash: string; mode: number }
  | { type: 'symlink'; linkTarget: string }

export interface AgentConfigReleaseOutput {
  id: string
  host: AgentHost
  layer: 'instructions' | 'skills'
  path: string
  livePath: string
  artifact: AgentConfigReleaseArtifact
}

export interface AgentConfigHostException {
  id: string
  host: AgentHost
  layer: 'skills' | 'agents'
}

export interface AgentConfigReleaseManifest {
  schemaVersion: 1
  sourceCommit: string
  sources: Record<string, unknown>
  artifacts: Record<string, AgentConfigReleaseArtifact>
  requirements: { node: string }
  releaseId: string
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

function hash(contents: Buffer | string): string {
  return createHash('sha256').update(contents).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || isAbsolute(path)) return false
  const normalized = path.replaceAll('\\', '/')
  return !normalized.split('/').some((part) => part === '' || part === '.' || part === '..')
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]),
  )
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function parseArtifact(value: unknown): AgentConfigReleaseArtifact | null {
  if (!isRecord(value)) return null
  if (
    value.type === 'file' &&
    typeof value.hash === 'string' &&
    SHA256.test(value.hash) &&
    (value.mode === 0o644 || value.mode === 0o755)
  ) {
    return { type: 'file', hash: value.hash, mode: value.mode }
  }
  if (
    value.type === 'symlink' &&
    typeof value.linkTarget === 'string' &&
    value.linkTarget.length > 0 &&
    !isAbsolute(value.linkTarget)
  ) {
    return { type: 'symlink', linkTarget: value.linkTarget }
  }
  return null
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
    typeof parsed.sourceCommit !== 'string' ||
    parsed.sourceCommit.length === 0 ||
    !isRecord(parsed.sources) ||
    !isRecord(parsed.artifacts) ||
    !isRecord(parsed.requirements) ||
    typeof parsed.requirements.node !== 'string' ||
    parsed.requirements.node.length === 0 ||
    typeof parsed.releaseId !== 'string' ||
    !SHA256.test(parsed.releaseId)
  ) {
    return null
  }

  const artifacts: Record<string, AgentConfigReleaseArtifact> = {}
  for (const [path, value] of Object.entries(parsed.artifacts)) {
    const artifact = parseArtifact(value)
    if (!isSafeRelativePath(path) || path === 'artifact-manifest.json' || artifact === null) {
      return null
    }
    artifacts[path] = artifact
  }
  if (Object.keys(artifacts).length === 0) return null

  return {
    schemaVersion: 1,
    sourceCommit: parsed.sourceCommit,
    sources: parsed.sources,
    artifacts,
    requirements: { node: parsed.requirements.node },
    releaseId: parsed.releaseId,
  }
}

function manifestIdentity(contents: Buffer): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(contents.toString('utf-8'))
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const { releaseId: _releaseId, ...core } = parsed
  return hash(canonicalJson(core))
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

function artifactContext(path: string): Partial<AgentConfigFinding> {
  const segments = path.split('/')
  if (path === 'claude/CLAUDE.md') {
    return { host: 'claude', layer: 'instructions', capability: 'global-instructions' }
  }
  if (path === 'codex/AGENTS.md') {
    return { host: 'codex', layer: 'instructions', capability: 'global-instructions' }
  }
  if (segments[0] === 'agents' && (segments[1] === 'claude' || segments[1] === 'codex')) {
    return {
      host: segments[1],
      layer: 'agents',
      capability: basename(path).replace(/\.(md|toml)$/u, ''),
    }
  }
  if (
    segments[0] === 'agents' &&
    (segments[1] === 'claude-only' || segments[1] === 'codex-only') &&
    segments[2] !== undefined &&
    segments[3] !== undefined
  ) {
    return {
      host: segments[1] === 'claude-only' ? 'claude' : 'codex',
      layer: 'agents',
      capability: `${segments[2]}.${basename(segments[3]).replace(/\.(json|md|toml)$/u, '')}`,
    }
  }
  if (segments[0] === 'hooks') {
    return { layer: 'hooks', ...(segments[1] === undefined ? {} : { capability: segments[1] }) }
  }
  if (segments[0] === 'skills') {
    const projectionHost = segments[1] === 'projections' ? segments[2] : undefined
    const capability = projectionHost === undefined ? segments[2] : segments[3]
    return {
      ...(projectionHost === 'claude' || projectionHost === 'codex'
        ? { host: projectionHost }
        : {}),
      layer: 'skills',
      ...(capability === undefined ? {} : { capability }),
    }
  }
  return { layer: 'release' }
}

function listArtifacts(root: string): string[] {
  const paths: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (relative(root, path) !== 'artifact-manifest.json') paths.push(relative(root, path))
    }
  }
  visit(root)
  return paths.sort((left, right) => left.localeCompare(right))
}

function samePaths(left: string[], right: string[]): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

interface ArtifactValidationOptions {
  stale: boolean
}

function staleArtifact(path: string, relativePath?: string): AgentConfigFinding {
  return {
    code: 'release-evidence-stale',
    status: 'unknown',
    reason: 'missing-evidence',
    message: 'A selected release artifact changed or became unavailable after validation.',
    path,
    ...(relativePath === undefined ? { layer: 'release' as const } : artifactContext(relativePath)),
  }
}

function validateArtifacts(
  root: string,
  manifest: AgentConfigReleaseManifest,
  options: ArtifactValidationOptions,
): AgentConfigFinding[] {
  let actualPaths: string[]
  try {
    actualPaths = listArtifacts(root)
  } catch {
    return options.stale
      ? [staleArtifact(root)]
      : [unknown('release-output-unavailable', 'The release artifact set is unavailable.', root)]
  }
  const expectedPaths = Object.keys(manifest.artifacts).sort((left, right) =>
    left.localeCompare(right),
  )
  if (!samePaths(actualPaths, expectedPaths)) {
    return options.stale
      ? [staleArtifact(root)]
      : [
          {
            code: 'release-artifact-set-mismatch',
            status: 'fail',
            message: 'The release artifact set differs from the manifest.',
            layer: 'release',
            path: root,
          },
        ]
  }

  const findings: AgentConfigFinding[] = []
  for (const path of expectedPaths) {
    const artifact = manifest.artifacts[path]!
    const outputPath = resolve(root, path)
    if (!isPathWithinBoundary(root, outputPath)) {
      findings.push(
        boundaryFailure(
          'release-output-outside-boundary',
          'A declared release artifact resolves outside the selected release.',
          outputPath,
        ),
      )
      continue
    }

    try {
      const state = lstatSync(outputPath)
      if (artifact.type === 'file') {
        if (state.isSymbolicLink()) {
          const resolvedTarget = realpathSync(outputPath)
          if (!isPathWithinBoundary(root, resolvedTarget)) {
            findings.push(
              boundaryFailure(
                'release-output-outside-boundary',
                'A declared release artifact resolves outside the selected release.',
                outputPath,
              ),
            )
            continue
          }
        }
        if (!state.isFile()) {
          findings.push(
            options.stale
              ? staleArtifact(outputPath, path)
              : {
                  code: 'release-output-hash-mismatch',
                  status: 'fail',
                  message: 'A release artifact does not match its file descriptor.',
                  path: outputPath,
                  ...artifactContext(path),
                },
          )
          continue
        }
        const observed = hash(readFileSync(outputPath))
        const observedMode = (state.mode & 0o111) === 0 ? 0o644 : 0o755
        if (observed !== artifact.hash || observedMode !== artifact.mode) {
          findings.push(
            options.stale
              ? staleArtifact(outputPath, path)
              : {
                  code: 'release-output-hash-mismatch',
                  status: 'fail',
                  message: 'A recomputed release artifact differs from the manifest.',
                  path: outputPath,
                  expected: artifact.hash,
                  observed,
                  ...artifactContext(path),
                },
          )
          continue
        }
        if (!options.stale) {
          findings.push({
            code: 'release-output-hash-valid',
            status: 'pass',
            message: 'The recomputed release artifact matches the manifest.',
            path: outputPath,
            expected: artifact.hash,
            observed,
            ...artifactContext(path),
          })
        }
        continue
      }

      if (!state.isSymbolicLink() || readlinkSync(outputPath) !== artifact.linkTarget) {
        findings.push(
          options.stale
            ? staleArtifact(outputPath, path)
            : {
                code: 'release-output-link-mismatch',
                status: 'fail',
                message: 'A release symlink differs from the manifest.',
                path: outputPath,
                ...artifactContext(path),
              },
        )
        continue
      }
      const lexicalTarget = resolve(dirname(outputPath), artifact.linkTarget)
      const resolvedTarget = realpathSync(outputPath)
      if (
        !isPathWithinBoundary(root, lexicalTarget) ||
        !isPathWithinBoundary(root, resolvedTarget)
      ) {
        findings.push(
          boundaryFailure(
            'release-output-outside-boundary',
            'A declared release symlink resolves outside the selected release.',
            outputPath,
          ),
        )
        continue
      }
      if (!options.stale) {
        findings.push({
          code: 'release-output-link-valid',
          status: 'pass',
          message: 'The release symlink matches the manifest and stays inside the release.',
          path: outputPath,
          ...artifactContext(path),
        })
      }
    } catch {
      findings.push(
        options.stale
          ? staleArtifact(outputPath, path)
          : unknown(
              'release-output-unavailable',
              'A declared release artifact is unavailable.',
              outputPath,
            ),
      )
    }
  }
  return findings
}

function isDirectRelease(releasesRoot: string, candidate: string): boolean {
  return dirname(candidate) === releasesRoot && SHA256.test(basename(candidate))
}

/** Revalidates all immutable evidence before callers emit parity results. */
export function revalidateAgentConfigRelease(
  release: ValidatedAgentConfigRelease,
): AgentConfigFinding[] {
  let manifestContents: Buffer
  try {
    const resolvedManifest = realpathSync(release.manifestPath)
    if (
      !isPathWithinBoundary(release.root, resolvedManifest) ||
      !statSync(resolvedManifest).isFile()
    ) {
      return [
        boundaryFailure(
          'release-evidence-outside-boundary',
          'The selected release manifest resolves outside the release boundary.',
        ),
      ]
    }
    manifestContents = readFileSync(resolvedManifest)
  } catch {
    return [
      unknown(
        'release-evidence-stale',
        'The selected release manifest changed or became unavailable after validation.',
      ),
    ]
  }
  const identity = manifestIdentity(manifestContents)
  if (
    hash(manifestContents) !== release.manifestHash ||
    identity !== release.manifest.releaseId ||
    basename(release.root) !== release.manifest.releaseId
  ) {
    return [
      unknown(
        'release-evidence-stale',
        'The selected release manifest changed or became unavailable after validation.',
      ),
    ]
  }
  return validateArtifacts(release.root, release.manifest, { stale: true })
}

/**
 * Selects `current`, verifies the canonical manifest identity used by the
 * shared renderer, and independently validates every declared artifact.
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
    if (!lstatSync(targetPath).isDirectory()) {
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

  const manifestPath = resolve(releaseRoot, 'artifact-manifest.json')
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

  const manifest = parseManifest(manifestContents)
  const observedIdentity = manifestIdentity(manifestContents)
  if (manifest === null || observedIdentity === null) {
    findings.push({
      code: 'release-manifest-invalid',
      status: 'fail',
      message: 'The release manifest does not match the renderer artifact schema.',
      layer: 'release',
      path: manifestPath,
    })
    return { findings }
  }
  const expectedIdentity = basename(releaseRoot)
  if (manifest.releaseId !== observedIdentity || expectedIdentity !== observedIdentity) {
    findings.push({
      code: 'release-identity-mismatch',
      status: 'fail',
      message: 'The canonical manifest identity differs from the immutable release directory.',
      layer: 'release',
      path: manifestPath,
      expected: expectedIdentity,
      observed: observedIdentity,
    })
    return { findings }
  }
  findings.push({
    code: 'release-identity-valid',
    status: 'pass',
    message: 'The canonical manifest identity matches the immutable release directory.',
    layer: 'release',
    path: manifestPath,
    expected: expectedIdentity,
    observed: observedIdentity,
  })

  const artifactFindings = validateArtifacts(releaseRoot, manifest, { stale: false })
  findings.push(...artifactFindings)
  if (artifactFindings.some((finding) => finding.status !== 'pass')) return { findings }

  return {
    release: {
      root: releaseRoot,
      manifestPath,
      manifestHash: hash(manifestContents),
      manifest,
    },
    findings,
  }
}
