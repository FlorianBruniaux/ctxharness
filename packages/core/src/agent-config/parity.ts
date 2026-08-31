import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { isPathWithinBoundary } from './inventory.js'
import {
  revalidateAgentConfigRelease,
  type AgentConfigHostException,
  type AgentConfigReleaseOutput,
  type ValidatedAgentConfigRelease,
} from './release.js'
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

function releaseOutputs(release: ValidatedAgentConfigRelease): AgentConfigReleaseOutput[] {
  const outputs: AgentConfigReleaseOutput[] = []
  const instructions = [
    ['claude', 'claude/CLAUDE.md', '.claude/CLAUDE.md'],
    ['codex', 'codex/AGENTS.md', '.codex/AGENTS.md'],
  ] as const
  for (const [host, path, livePath] of instructions) {
    const artifact = release.manifest.artifacts[path]
    if (artifact !== undefined) {
      outputs.push({
        id: 'global-instructions',
        host,
        layer: 'instructions',
        path,
        livePath,
        artifact,
      })
    }
  }

  for (const [path, artifact] of Object.entries(release.manifest.artifacts)) {
    const match = path.match(/^skills\/projections\/(claude|codex)\/([^/]+)$/u)
    if (match === null || artifact.type !== 'symlink') continue
    const host = match[1] as AgentHost
    const id = match[2]!
    outputs.push({
      id,
      host,
      layer: 'skills',
      path,
      livePath: host === 'claude' ? `.claude/skills/${id}` : `.agents/skills/${id}`,
      artifact,
    })
  }
  return outputs
}

function releaseExceptions(release: ValidatedAgentConfigRelease): AgentConfigHostException[] {
  const exceptions = new Map<string, AgentConfigHostException>()
  for (const path of Object.keys(release.manifest.artifacts)) {
    const match = path.match(/^skills\/(claude-only|codex-only)\/([^/]+)\//u)
    if (match === null) continue
    const host = match[1] === 'claude-only' ? 'codex' : 'claude'
    const id = match[2]!
    exceptions.set(`${id}:${host}`, { id, host, layer: 'skills' })
  }
  return [...exceptions.values()]
}

function unavailable(output: AgentConfigReleaseOutput, path: string): AgentConfigFinding {
  return {
    code: 'live-output-unavailable',
    status: 'unknown',
    reason: 'missing-evidence',
    message: 'A live instruction or skill is unavailable.',
    host: output.host,
    layer: output.layer,
    path,
    capability: output.id,
  }
}

function outside(output: AgentConfigReleaseOutput): AgentConfigFinding {
  return {
    code: 'live-output-outside-boundary',
    status: 'fail',
    reason: 'outside-boundary',
    message: 'A live output resolves outside the injected home and selected release boundaries.',
    host: output.host,
    layer: output.layer,
    capability: output.id,
  }
}

function divergence(
  output: AgentConfigReleaseOutput,
  path: string,
  severity: 'warn' | 'fail',
  expected?: string,
  observed?: string,
): AgentConfigFinding {
  return {
    code: 'live-output-divergence',
    status: severity,
    message: 'A live instruction or skill differs from the selected release.',
    host: output.host,
    layer: output.layer,
    path,
    capability: output.id,
    ...(expected === undefined ? {} : { expected }),
    ...(observed === undefined ? {} : { observed }),
  }
}

function checkLiveOutput(
  release: ValidatedAgentConfigRelease,
  home: string,
  output: AgentConfigReleaseOutput,
  severity: 'warn' | 'fail',
): AgentConfigFinding {
  const livePath = resolve(home, output.livePath)
  if (!isPathWithinBoundary(home, livePath)) return outside(output)

  if (output.artifact.type === 'file') {
    let observed: string
    try {
      const resolvedLivePath = realpathSync(livePath)
      if (!isPathWithinBoundary(home, resolvedLivePath) || !statSync(resolvedLivePath).isFile()) {
        return outside(output)
      }
      observed = hashFile(resolvedLivePath)
    } catch {
      return unavailable(output, livePath)
    }
    if (observed !== output.artifact.hash) {
      return divergence(output, livePath, severity, output.artifact.hash, observed)
    }
    return {
      code: 'live-output-match',
      status: 'pass',
      message: 'A live instruction or skill matches the selected release.',
      host: output.host,
      layer: output.layer,
      path: livePath,
      capability: output.id,
      expected: output.artifact.hash,
      observed,
    }
  }

  try {
    const releasePath = resolve(release.root, output.path)
    const expectedTarget = realpathSync(releasePath)
    const liveState = lstatSync(livePath)
    if (!liveState.isSymbolicLink()) return divergence(output, livePath, severity)
    const observedTarget = realpathSync(livePath)
    if (observedTarget !== expectedTarget) {
      if (!isPathWithinBoundary(release.root, observedTarget)) return outside(output)
      return divergence(output, livePath, severity)
    }
    return {
      code: 'live-output-match',
      status: 'pass',
      message: 'A live instruction or skill matches the selected release.',
      host: output.host,
      layer: output.layer,
      path: livePath,
      capability: output.id,
    }
  } catch {
    return unavailable(output, livePath)
  }
}

/** Compares selected release intent and live instructions/skills across hosts. */
export function checkAgentConfigParity(options: AgentConfigParityOptions): AgentConfigFinding[] {
  const releaseEvidenceFindings = revalidateAgentConfigRelease(options.release)
  if (releaseEvidenceFindings.length > 0) return releaseEvidenceFindings

  const requestedHome = resolve(options.home)
  let home = requestedHome
  try {
    home = realpathSync(requestedHome)
  } catch {
    // Individual live outputs remain UNKNOWN when the injected home is unavailable.
  }
  const findings: AgentConfigFinding[] = []
  const outputs = releaseOutputs(options.release)
  const hostExceptions = releaseExceptions(options.release)
  const byId = new Map<string, AgentConfigReleaseOutput[]>()
  const exceptions = new Map<string, Set<AgentHost>>()

  for (const output of outputs) {
    const current = byId.get(output.id)
    if (current === undefined) byId.set(output.id, [output])
    else current.push(output)
    findings.push(
      checkLiveOutput(options.release, home, output, options.policy.undeclaredDivergence),
    )
  }

  for (const exception of hostExceptions) {
    const current = exceptions.get(exception.id)
    if (current === undefined) exceptions.set(exception.id, new Set([exception.host]))
    else current.add(exception.host)
    findings.push({
      code: 'host-exception-declared',
      status: 'not-applicable',
      message: 'The release namespace declares this skill unsupported for the host.',
      host: exception.host,
      layer: exception.layer,
      capability: exception.id,
    })
  }

  const ids = new Set([...byId.keys(), ...exceptions.keys()])
  for (const id of ids) {
    const capabilityOutputs = byId.get(id) ?? []
    const layer = capabilityOutputs[0]?.layer
    const outputHosts = new Set(capabilityOutputs.map((output) => output.host))
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
