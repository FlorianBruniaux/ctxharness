import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
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

interface HookCommandPath {
  path: string
  access: 'executable' | 'readable'
}

const SCRIPT_INTERPRETERS = new Set(['bash', 'node', 'nodejs', 'sh', 'zsh'])
const INTERPRETER_PATH_OPTIONS = new Set(['--require', '-r'])

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

function resolveCommandPaths(
  command: string,
  inventory: AgentConfigInventory,
  evidence: AgentConfigEvidence,
): HookCommandPath[] | null {
  const rawTokens = command.match(/"[^"]+"|'[^']+'|\S+/g) ?? []
  const tokens = rawTokens.map((rawToken) => {
    let token = rawToken.replace(/^['"]|['"]$/g, '')
    token = token.replace(/^\$\{CLAUDE_PROJECT_DIR\}/, inventory.root)
    token = token.replace(/^\$CLAUDE_PROJECT_DIR/, inventory.root)
    if (token.startsWith('~/')) token = join(inventory.home, token.slice(2))
    return token
  })

  const isPathLike = (token: string): boolean =>
    isAbsolute(token) ||
    token.startsWith('./') ||
    token.startsWith('../') ||
    token.startsWith('.claude/') ||
    token.startsWith('.codex/')
  const resolveToken = (token: string): string => {
    if (isAbsolute(token)) return token
    const boundary = evidence.scope === 'project' ? inventory.root : inventory.home
    return resolve(boundary, token)
  }

  let launcherIndex = 0
  const launcherPaths: HookCommandPath[] = []
  const first = tokens[0]
  if (first === undefined) return null
  if (basename(first) === 'env') {
    if (isPathLike(first)) {
      launcherPaths.push({ path: resolveToken(first), access: 'executable' })
    }
    launcherIndex = 1
    while (launcherIndex < tokens.length) {
      const token = tokens[launcherIndex]
      if (token === undefined) break
      if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(token)) {
        launcherIndex++
        continue
      }
      if (token === '-u' || token === '--unset') {
        if (tokens[launcherIndex + 1] === undefined) return null
        launcherIndex += 2
        continue
      }
      if (token.startsWith('--unset=')) {
        launcherIndex++
        continue
      }
      if (token === '-S' || token === '--split-string' || token.startsWith('--split-string=')) {
        return null
      }
      if (token === '--') {
        launcherIndex++
        break
      }
      if (token.startsWith('-')) return null
      break
    }
  }

  const launcher = tokens[launcherIndex]
  if (launcher === undefined) return null
  if (SCRIPT_INTERPRETERS.has(basename(launcher))) {
    if (isPathLike(launcher)) {
      launcherPaths.push({ path: resolveToken(launcher), access: 'executable' })
    }

    const optionPaths: HookCommandPath[] = []
    let scriptPath: HookCommandPath | null = null
    for (let index = launcherIndex + 1; index < tokens.length; index++) {
      const token = tokens[index]
      if (token === undefined) break
      if (token === '--') {
        const script = tokens[index + 1]
        if (script === undefined) return null
        scriptPath = { path: resolveToken(script), access: 'readable' }
        break
      }
      const optionSeparator = token.indexOf('=')
      const option = optionSeparator === -1 ? token : token.slice(0, optionSeparator)
      if (INTERPRETER_PATH_OPTIONS.has(option)) {
        const optionValue =
          optionSeparator === -1 ? tokens[++index] : token.slice(optionSeparator + 1)
        if (optionValue === undefined || !isPathLike(optionValue)) return null
        optionPaths.push({ path: resolveToken(optionValue), access: 'readable' })
        continue
      }
      if (token.startsWith('-')) return null
      scriptPath = { path: resolveToken(token), access: 'readable' }
      break
    }
    if (scriptPath === null) return null
    return [...launcherPaths, ...optionPaths, scriptPath]
  }

  if (isPathLike(launcher)) {
    launcherPaths.push({ path: resolveToken(launcher), access: 'executable' })
  }
  return launcherPaths.length === 0 ? null : launcherPaths
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

function readable(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    const stats = statSync(path)
    return stats.isFile() && (stats.mode & 0o444) !== 0
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

      const commandPaths = resolveCommandPaths(command.command, inventory, evidence)
      if (commandPaths === null) {
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

      const resolved = commandPaths.every((candidate) =>
        candidate.access === 'executable' ? executable(candidate.path) : readable(candidate.path),
      )
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
