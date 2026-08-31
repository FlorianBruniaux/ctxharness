import { readFileSync, realpathSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { isPathWithinBoundary } from './inventory.js'
import type { AgentConfigReleaseOutput, ValidatedAgentConfigRelease } from './release.js'
import type { AgentConfigFinding, AgentHost } from './types.js'

export interface AgentConfigParityPolicy {
  /** Severity for known, undeclared differences. */
  undeclaredDivergence: 'warn' | 'fail'
}

export interface AgentConfigParityOptions {
  release: ValidatedAgentConfigRelease
  /** Explicit global configuration boundary for live outputs. */
  home: string
  policy: AgentConfigParityPolicy
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function staleReleaseFinding(output: AgentConfigReleaseOutput): AgentConfigFinding {
  return {
    code: 'release-evidence-stale',
    status: 'unknown',
    reason: 'missing-evidence',
    message: 'The selected release output changed or became unavailable after validation.',
    host: output.host,
    layer: output.layer,
    capability: output.id,
  }
}

function checkManifestEvidence(release: ValidatedAgentConfigRelease): AgentConfigFinding | null {
  try {
    const resolvedManifest = realpathSync(release.manifestPath)
    if (
      !isPathWithinBoundary(release.root, resolvedManifest) ||
      !statSync(resolvedManifest).isFile()
    ) {
      return {
        code: 'release-evidence-outside-boundary',
        status: 'fail',
        reason: 'outside-boundary',
        message: 'The selected release manifest resolves outside the release boundary.',
        layer: 'release',
      }
    }
    if (hashFile(resolvedManifest) === release.manifestHash) return null
  } catch {
    // Missing or unreadable evidence is normalized below.
  }
  return {
    code: 'release-evidence-stale',
    status: 'unknown',
    reason: 'missing-evidence',
    message: 'The selected release manifest changed or became unavailable after validation.',
    layer: 'release',
  }
}

function checkLiveOutput(
  release: ValidatedAgentConfigRelease,
  home: string,
  output: AgentConfigReleaseOutput,
  severity: 'warn' | 'fail',
): AgentConfigFinding {
  const releasePath = resolve(release.root, output.path)
  try {
    const resolvedReleasePath = realpathSync(releasePath)
    if (
      !isPathWithinBoundary(release.root, resolvedReleasePath) ||
      !statSync(resolvedReleasePath).isFile() ||
      hashFile(resolvedReleasePath) !== output.sha256
    )
      return staleReleaseFinding(output)
  } catch {
    return staleReleaseFinding(output)
  }

  const livePath = resolve(home, output.livePath)
  if (!isPathWithinBoundary(home, livePath)) {
    return {
      code: 'live-output-outside-boundary',
      status: 'fail',
      reason: 'outside-boundary',
      message: 'A live output path resolves outside the injected home boundary.',
      host: output.host,
      layer: output.layer,
      capability: output.id,
    }
  }

  let observed: string
  try {
    const resolvedLivePath = realpathSync(livePath)
    if (!isPathWithinBoundary(home, resolvedLivePath) || !statSync(resolvedLivePath).isFile()) {
      return {
        code: 'live-output-outside-boundary',
        status: 'fail',
        reason: 'outside-boundary',
        message: 'A live output resolves outside the injected home boundary.',
        host: output.host,
        layer: output.layer,
        capability: output.id,
      }
    }
    observed = hashFile(resolvedLivePath)
  } catch {
    return {
      code: 'live-output-unavailable',
      status: 'unknown',
      reason: 'missing-evidence',
      message: 'A live instruction or skill is unavailable.',
      host: output.host,
      layer: output.layer,
      path: livePath,
      capability: output.id,
    }
  }

  if (observed !== output.sha256) {
    return {
      code: 'live-output-divergence',
      status: severity,
      message: 'A live instruction or skill differs from the selected release.',
      host: output.host,
      layer: output.layer,
      path: livePath,
      capability: output.id,
      expected: output.sha256,
      observed,
    }
  }
  return {
    code: 'live-output-match',
    status: 'pass',
    message: 'A live instruction or skill matches the selected release.',
    host: output.host,
    layer: output.layer,
    path: livePath,
    capability: output.id,
    expected: output.sha256,
    observed,
  }
}

/** Compares selected release intent and live instructions/skills across hosts. */
export function checkAgentConfigParity(options: AgentConfigParityOptions): AgentConfigFinding[] {
  const manifestFinding = checkManifestEvidence(options.release)
  if (manifestFinding !== null) return [manifestFinding]

  const requestedHome = resolve(options.home)
  let home = requestedHome
  try {
    home = realpathSync(requestedHome)
  } catch {
    // Individual live outputs remain UNKNOWN when the injected home is unavailable.
  }
  const findings: AgentConfigFinding[] = []
  const byId = new Map<string, AgentConfigReleaseOutput[]>()
  const exceptions = new Map<string, Set<AgentHost>>()

  for (const output of options.release.manifest.outputs) {
    const current = byId.get(output.id)
    if (current === undefined) byId.set(output.id, [output])
    else current.push(output)

    if (output.layer === 'instructions' || output.layer === 'skills') {
      findings.push(
        checkLiveOutput(options.release, home, output, options.policy.undeclaredDivergence),
      )
    }
  }

  for (const exception of options.release.manifest.hostExceptions) {
    const current = exceptions.get(exception.id)
    if (current === undefined) exceptions.set(exception.id, new Set([exception.host]))
    else current.add(exception.host)
    const layer = byId.get(exception.id)?.[0]?.layer
    findings.push({
      code: 'host-exception-declared',
      status: 'not-applicable',
      message: 'The selected release declares this capability unsupported for the host.',
      host: exception.host,
      ...(layer === undefined ? {} : { layer }),
      capability: exception.id,
    })
  }

  const ids = new Set([...byId.keys(), ...exceptions.keys()])
  for (const id of ids) {
    const outputs = byId.get(id) ?? []
    const layer = outputs[0]?.layer
    const outputHosts = new Set(outputs.map((output) => output.host))
    const exceptionHosts = exceptions.get(id) ?? new Set<AgentHost>()
    for (const host of ['claude', 'codex'] as const) {
      if (outputHosts.has(host) || exceptionHosts.has(host)) continue
      findings.push({
        code: 'host-parity-divergence',
        status: options.policy.undeclaredDivergence,
        message: 'A shared capability has neither a host output nor a declared exception.',
        host,
        ...(layer === undefined ? {} : { layer }),
        capability: id,
      })
    }
  }

  return findings
}
