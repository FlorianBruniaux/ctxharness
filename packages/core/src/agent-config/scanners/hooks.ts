import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { isPathWithinBoundary } from '../inventory.js'
import type { AgentConfigEvidence, AgentConfigFinding, AgentConfigInventory } from '../types.js'

interface ValidHookCommand {
  valid: true
  command: string
}

interface InvalidHookCommand {
  valid: false
}

type HookCommand = ValidHookCommand | InvalidHookCommand

function collectCommands(value: unknown, commands: HookCommand[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectCommands(item, commands)
    return
  }
  if (typeof value !== 'object' || value === null) return

  const fields = value as Record<string, unknown>
  if (fields['type'] === 'command') {
    if (typeof fields['command'] === 'string' && fields['command'].trim() !== '') {
      commands.push({ valid: true, command: fields['command'] })
    } else {
      commands.push({ valid: false })
    }
  }
  for (const child of Object.values(fields)) collectCommands(child, commands)
}

function parseHookCommands(path: string): HookCommand[] | null {
  try {
    const content = readFileSync(path, 'utf-8')
    const parsed = path.endsWith('.toml') ? parseToml(content) : JSON.parse(content)
    if (typeof parsed !== 'object' || parsed === null) return null
    const hooks = (parsed as Record<string, unknown>)['hooks']
    if (hooks === undefined) return []
    const commands: HookCommand[] = []
    collectCommands(hooks, commands)
    return commands
  } catch {
    return null
  }
}

function resolveCommandPath(
  command: string,
  inventory: AgentConfigInventory,
  evidence: AgentConfigEvidence,
): string | null {
  const tokens = command.match(/"[^"]+"|'[^']+'|\S+/g) ?? []
  for (const rawToken of tokens) {
    let token = rawToken.replace(/^['"]|['"]$/g, '')
    token = token.replace(/^\$\{CLAUDE_PROJECT_DIR\}/, inventory.root)
    token = token.replace(/^\$CLAUDE_PROJECT_DIR/, inventory.root)
    if (token.startsWith('~/')) token = join(inventory.home, token.slice(2))

    const pathLike =
      isAbsolute(token) ||
      token.startsWith('./') ||
      token.startsWith('../') ||
      token.startsWith('.claude/') ||
      token.startsWith('.codex/')
    if (!pathLike) continue

    if (isAbsolute(token)) return token
    const boundary = evidence.scope === 'project' ? inventory.root : inventory.home
    return resolve(boundary, token)
  }
  return null
}

function executable(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    const stats = statSync(path)
    return stats.isFile() && (stats.mode & 0o111) !== 0
  } catch {
    return false
  }
}

function withinScopeBoundary(path: string, boundary: string): boolean {
  try {
    return isPathWithinBoundary(realpathSync(boundary), realpathSync(path))
  } catch {
    return false
  }
}

function hookSources(inventory: AgentConfigInventory): {
  sources: AgentConfigEvidence[]
  findings: AgentConfigFinding[]
} {
  const sources: AgentConfigEvidence[] = []
  const findings: AgentConfigFinding[] = []

  for (const capability of inventory.capabilities.filter(
    (candidate) => candidate.layer === 'hooks',
  )) {
    sources.push(capability.evidence)
  }

  for (const root of inventory.roots.filter(
    (candidate) => candidate.host === 'codex' && candidate.layer === 'hooks',
  )) {
    const jsonPath = join(dirname(root.path), 'hooks.json')
    if (!existsSync(jsonPath)) continue
    if (withinScopeBoundary(jsonPath, root.boundary)) {
      sources.push({
        host: root.host,
        scope: root.scope,
        layer: 'hooks',
        root: root.path,
        path: jsonPath,
      })
    } else {
      findings.push({
        code: 'hook-source-outside-boundary',
        status: 'fail',
        reason: 'outside-boundary',
        message: 'Adjacent Codex hooks.json resolves outside the selected scope boundary.',
        host: root.host,
        scope: root.scope,
        layer: 'hooks',
        path: jsonPath,
      })
    }
  }

  const unique = new Map(
    sources.map((source) => [`${source.host}:${source.scope}:${source.path}`, source]),
  )
  return { sources: [...unique.values()], findings }
}

/** Parses native hook declarations and verifies referenced executable paths. */
export function scanHooks(inventory: AgentConfigInventory): AgentConfigFinding[] {
  const sourceResult = hookSources(inventory)
  const findings = sourceResult.findings

  for (const evidence of sourceResult.sources) {
    const commands = parseHookCommands(evidence.path)
    if (commands === null) {
      findings.push({
        code: 'hook-config-invalid',
        status: 'fail',
        message: `Hook configuration is not valid ${evidence.path.endsWith('.toml') ? 'TOML' : 'JSON'}.`,
        host: evidence.host,
        scope: evidence.scope,
        layer: 'hooks',
        path: evidence.path,
        evidence: [evidence],
      })
      continue
    }

    for (const command of commands) {
      if (!command.valid) {
        findings.push({
          code: 'hook-command-invalid',
          status: 'fail',
          message: 'Hook command declaration requires a non-empty string command.',
          host: evidence.host,
          scope: evidence.scope,
          layer: 'hooks',
          path: evidence.path,
          evidence: [evidence],
        })
        continue
      }

      const commandPath = resolveCommandPath(command.command, inventory, evidence)
      if (commandPath === null) {
        findings.push({
          code: 'hook-command-unverified',
          status: 'unknown',
          reason: 'missing-evidence',
          message: 'Hook command relies on PATH resolution that was not verified.',
          host: evidence.host,
          scope: evidence.scope,
          layer: 'hooks',
          path: evidence.path,
          evidence: [evidence],
        })
        continue
      }

      const resolved = executable(commandPath)
      findings.push({
        code: resolved ? 'hook-command-resolved' : 'hook-command-unresolved',
        status: resolved ? 'pass' : 'fail',
        message: resolved
          ? 'Hook command references a resolvable executable path.'
          : 'Hook command references an unavailable or non-executable path.',
        host: evidence.host,
        scope: evidence.scope,
        layer: 'hooks',
        path: evidence.path,
        evidence: [evidence],
      })
    }
  }

  return findings
}
