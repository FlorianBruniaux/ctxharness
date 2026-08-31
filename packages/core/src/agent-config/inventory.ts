import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { resolveClaudeRoots } from './adapters/claude.js'
import { resolveCodexRoots } from './adapters/codex.js'
import type {
  AgentConfigCapability,
  AgentConfigEvidence,
  AgentConfigFinding,
  AgentConfigInventory,
  AgentConfigInventoryOptions,
  AgentConfigRoot,
  AgentConfigSkill,
  AgentConfigScope,
} from './types.js'

const DEFAULT_HOSTS = ['claude', 'codex'] as const
const DEFAULT_SCOPES = ['project', 'global'] as const
const SKILL_MANIFEST = 'SKILL.md'

export interface AgentConfigPathApi {
  relative(from: string, to: string): string
  isAbsolute(path: string): boolean
  sep: string
}

const nativePath: AgentConfigPathApi = { relative, isAbsolute, sep }

/** Returns whether a candidate remains under a boundary for the supplied path semantics. */
export function isPathWithinBoundary(
  boundary: string,
  candidate: string,
  path: AgentConfigPathApi = nativePath,
): boolean {
  const relativePath = path.relative(boundary, candidate)
  return relativePath === '' || (
    !path.isAbsolute(relativePath) &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`)
  )
}

function resolveExistingPath(path: string, boundary: string): string | null {
  if (!existsSync(path)) return null
  const resolvedBoundary = realpathSync(boundary)
  const resolvedPath = realpathSync(path)
  return isPathWithinBoundary(resolvedBoundary, resolvedPath) ? resolvedPath : null
}

function evidenceFor(root: AgentConfigRoot, path: string): AgentConfigEvidence {
  return {
    host: root.host,
    scope: root.scope,
    layer: root.layer,
    root: root.path,
    path,
  }
}

function pathEscapeFinding(root: AgentConfigRoot, path: string): AgentConfigFinding {
  return {
    code: 'path-outside-boundary',
    status: 'fail',
    reason: 'outside-boundary',
    message: `Configuration path resolves outside the selected ${root.scope} boundary.`,
    host: root.host,
    scope: root.scope,
    layer: root.layer,
    path,
  }
}

function unavailableRootFinding(root: AgentConfigRoot): AgentConfigFinding {
  return {
    code: 'configured-root-unavailable',
    status: 'unknown',
    reason: 'missing-evidence',
    message: `Configured ${root.scope} ${root.layer} root is unavailable.`,
    host: root.host,
    scope: root.scope,
    layer: root.layer,
    path: root.path,
  }
}

function discoverSkillPaths(root: AgentConfigRoot, findings: AgentConfigFinding[]): string[] {
  const skills: string[] = []
  const visit = (directory: string): void => {
    const resolvedDirectory = resolveExistingPath(directory, root.boundary)
    if (resolvedDirectory === null) {
      if (existsSync(directory)) findings.push(pathEscapeFinding(root, directory))
      return
    }

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = resolve(directory, entry.name)
      let stats
      try {
        stats = statSync(candidate)
      } catch {
        continue
      }
      if (!stats.isDirectory()) continue

      const manifest = resolve(candidate, SKILL_MANIFEST)
      if (existsSync(manifest)) {
        const resolvedManifest = resolveExistingPath(manifest, root.boundary)
        if (resolvedManifest === null) findings.push(pathEscapeFinding(root, manifest))
        else skills.push(manifest)
        continue
      }
      visit(candidate)
    }
  }

  visit(root.path)
  return skills
}

function resolveRoots(options: AgentConfigInventoryOptions, root: string, home: string): AgentConfigRoot[] {
  const hosts = options.hosts ?? DEFAULT_HOSTS
  const scopes = options.scopes ?? DEFAULT_SCOPES
  const roots: AgentConfigRoot[] = []

  for (const scope of scopes) {
    const boundary = scope === 'project' ? root : home
    for (const host of hosts) {
      if (host === 'claude') roots.push(...resolveClaudeRoots(scope, boundary))
      else roots.push(...resolveCodexRoots(scope, boundary))
    }
  }

  return roots
}

/**
 * Discovers existing Claude Code and Codex configuration without reading from
 * process.cwd() or os.homedir(). The caller owns both scope boundaries.
 */
export function inventoryAgentConfig(options: AgentConfigInventoryOptions): AgentConfigInventory {
  const root = resolve(options.root)
  const home = resolve(options.home)
  const roots = resolveRoots(options, root, home)
  const capabilities: AgentConfigCapability[] = []
  const skills: AgentConfigSkill[] = []
  const findings: AgentConfigFinding[] = []

  for (const configRoot of roots) {
    if (!existsSync(configRoot.path)) {
      findings.push(unavailableRootFinding(configRoot))
      continue
    }

    if (configRoot.layer === 'skills') {
      for (const path of discoverSkillPaths(configRoot, findings)) {
        const evidence = evidenceFor(configRoot, path)
        const name = relative(configRoot.path, path).replace(/[/\\]SKILL\.md$/, '')
        const existing = skills.find((skill) => skill.host === configRoot.host && skill.name === name)
        if (existing) existing.evidence.push(evidence)
        else skills.push({ host: configRoot.host, name, evidence: [evidence] })
      }
      continue
    }

    const resolvedPath = resolveExistingPath(configRoot.path, configRoot.boundary)
    if (resolvedPath === null) {
      findings.push(pathEscapeFinding(configRoot, configRoot.path))
      continue
    }

    capabilities.push({
      host: configRoot.host,
      scope: configRoot.scope,
      layer: configRoot.layer,
      path: configRoot.path,
      evidence: evidenceFor(configRoot, configRoot.path),
    })
  }

  return { root, home, roots, capabilities, skills, findings }
}

export function resolveProjectConfigRoots(host: 'claude' | 'codex', root: string): AgentConfigRoot[] {
  const boundary = resolve(root)
  return host === 'claude'
    ? resolveClaudeRoots('project', boundary)
    : resolveCodexRoots('project', boundary)
}

export function resolveGlobalConfigRoots(host: 'claude' | 'codex', home: string): AgentConfigRoot[] {
  const boundary = resolve(home)
  return host === 'claude'
    ? resolveClaudeRoots('global', boundary)
    : resolveCodexRoots('global', boundary)
}
