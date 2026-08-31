import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import type { AgentConfigEvidence, AgentConfigFinding, AgentConfigInventory } from '../types.js'

interface HookCommand {
  command: string
}

function collectCommands(value: unknown, commands: HookCommand[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectCommands(item, commands)
    return
  }
  if (typeof value !== 'object' || value === null) return

  const fields = value as Record<string, unknown>
  if (fields['type'] === 'command' && typeof fields['command'] === 'string') {
    commands.push({ command: fields['command'] })
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

function hookSources(inventory: AgentConfigInventory): AgentConfigEvidence[] {
  const sources: AgentConfigEvidence[] = []

  for (const root of inventory.roots.filter((candidate) => candidate.layer === 'hooks')) {
    if (existsSync(root.path)) {
      sources.push({
        host: root.host,
        scope: root.scope,
        layer: 'hooks',
        root: root.path,
        path: root.path,
      })
    }

    if (root.host === 'codex') {
      const jsonPath = join(dirname(root.path), 'hooks.json')
      if (existsSync(jsonPath)) {
        sources.push({
          host: 'codex',
          scope: root.scope,
          layer: 'hooks',
          root: jsonPath,
          path: jsonPath,
        })
      }
    }
  }

  const unique = new Map(
    sources.map((source) => [`${source.host}:${source.scope}:${source.path}`, source]),
  )
  return [...unique.values()]
}

/** Parses native hook declarations and verifies referenced executable paths. */
export function scanHooks(inventory: AgentConfigInventory): AgentConfigFinding[] {
  const findings: AgentConfigFinding[] = []

  for (const evidence of hookSources(inventory)) {
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
