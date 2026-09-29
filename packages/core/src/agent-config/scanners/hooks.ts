import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { isPathWithinBoundary } from '../inventory.js'
import type { AgentConfigEvidence, AgentConfigFinding, AgentConfigInventory } from '../types.js'

interface ValidHookCommand {
  valid: true
  command: string
  /** Exec form: `command` is one executable and `args` its argument vector. */
  exec: boolean
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
      commands.push({
        valid: true,
        command: fields['command'],
        exec: Array.isArray(fields['args']),
      })
    } else {
      commands.push({ valid: false })
    }
  }
  for (const child of Object.values(fields)) collectCommands(child, commands)
}

interface ParsedHooks {
  hooks: unknown
  commands: HookCommand[]
}

function parseHookCommands(path: string): ParsedHooks | null {
  try {
    const content = readFileSync(path, 'utf-8')
    const parsed = path.endsWith('.toml') ? parseToml(content) : JSON.parse(content)
    if (typeof parsed !== 'object' || parsed === null) return null
    const hooks = (parsed as Record<string, unknown>)['hooks']
    if (hooks === undefined) return { hooks: undefined, commands: [] }
    const commands: HookCommand[] = []
    collectCommands(hooks, commands)
    return { hooks, commands }
  } catch {
    return null
  }
}

type HandlerType = 'command' | 'http' | 'mcp_tool' | 'prompt' | 'agent'

interface EventSpec {
  matcher: boolean
  handlers: readonly HandlerType[]
}

const ALL: readonly HandlerType[] = ['command', 'http', 'mcp_tool', 'prompt', 'agent']
const NO_LLM: readonly HandlerType[] = ['command', 'http', 'mcp_tool']
const COMMAND_MCP: readonly HandlerType[] = ['command', 'mcp_tool']

/**
 * Claude Code hook events, matcher support and handler-type support, from
 * code.claude.com/docs/en/hooks ("Hook lifecycle", "Matcher patterns",
 * "Prompt-based hooks").
 */
const CLAUDE_EVENTS: Record<string, EventSpec> = {
  SessionStart: { matcher: true, handlers: COMMAND_MCP },
  Setup: { matcher: true, handlers: COMMAND_MCP },
  UserPromptSubmit: { matcher: false, handlers: ALL },
  UserPromptExpansion: { matcher: true, handlers: ALL },
  PreToolUse: { matcher: true, handlers: ALL },
  PermissionRequest: { matcher: true, handlers: ['command', 'http', 'mcp_tool', 'prompt'] },
  PermissionDenied: { matcher: true, handlers: ALL },
  PostToolUse: { matcher: true, handlers: ALL },
  PostToolUseFailure: { matcher: true, handlers: ALL },
  PostToolBatch: { matcher: false, handlers: ALL },
  Notification: { matcher: true, handlers: NO_LLM },
  MessageDisplay: { matcher: false, handlers: NO_LLM },
  SubagentStart: { matcher: true, handlers: NO_LLM },
  SubagentStop: { matcher: true, handlers: ALL },
  TaskCreated: { matcher: false, handlers: ALL },
  TaskCompleted: { matcher: false, handlers: ALL },
  Stop: { matcher: false, handlers: ALL },
  StopFailure: { matcher: true, handlers: NO_LLM },
  TeammateIdle: { matcher: false, handlers: ALL },
  InstructionsLoaded: { matcher: true, handlers: NO_LLM },
  ConfigChange: { matcher: true, handlers: NO_LLM },
  CwdChanged: { matcher: false, handlers: NO_LLM },
  DirectoryAdded: { matcher: true, handlers: NO_LLM },
  FileChanged: { matcher: true, handlers: NO_LLM },
  WorktreeCreate: { matcher: false, handlers: NO_LLM },
  WorktreeRemove: { matcher: false, handlers: NO_LLM },
  PreCompact: { matcher: true, handlers: NO_LLM },
  PostCompact: { matcher: true, handlers: NO_LLM },
  PreModelSwitch: { matcher: true, handlers: NO_LLM },
  PostModelSwitch: { matcher: true, handlers: NO_LLM },
  Elicitation: { matcher: true, handlers: NO_LLM },
  ElicitationResult: { matcher: true, handlers: NO_LLM },
  SessionEnd: { matcher: true, handlers: NO_LLM },
}

/**
 * Codex hook events from the Codex "Hooks" documentation. Codex parses but
 * skips `prompt` and `agent` handlers and supports `command` and `mcp_tool`.
 */
const CODEX_EVENTS: Record<string, EventSpec> = {
  SessionStart: { matcher: true, handlers: COMMAND_MCP },
  SessionEnd: { matcher: true, handlers: COMMAND_MCP },
  SubagentStart: { matcher: true, handlers: COMMAND_MCP },
  SubagentStop: { matcher: true, handlers: COMMAND_MCP },
  PreToolUse: { matcher: true, handlers: COMMAND_MCP },
  PermissionRequest: { matcher: true, handlers: COMMAND_MCP },
  PostToolUse: { matcher: true, handlers: COMMAND_MCP },
  PreCompact: { matcher: true, handlers: COMMAND_MCP },
  PostCompact: { matcher: true, handlers: COMMAND_MCP },
  UserPromptSubmit: { matcher: false, handlers: COMMAND_MCP },
  Stop: { matcher: false, handlers: COMMAND_MCP },
  Interrupt: { matcher: false, handlers: COMMAND_MCP },
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Checks event names, ignored matchers and unsupported handler types. */
function semanticFindings(hooks: unknown, evidence: AgentConfigEvidence): AgentConfigFinding[] {
  const events = asRecord(hooks)
  if (events === null) return []
  const table = evidence.host === 'claude' ? CLAUDE_EVENTS : CODEX_EVENTS
  const base = {
    host: evidence.host,
    scope: evidence.scope,
    layer: 'hooks' as const,
    path: evidence.path,
    evidence: [evidence],
  }
  const findings: AgentConfigFinding[] = []

  for (const [event, groups] of Object.entries(events)) {
    // Codex persists per-hook trust (`enabled`, `trusted_hash`) under
    // `[hooks.state]` in config.toml; it is not a lifecycle event.
    if (evidence.host === 'codex' && event === 'state') continue
    const spec = table[event]
    if (spec === undefined) {
      findings.push({
        ...base,
        code: 'hook-event-unknown',
        status: 'warn',
        message: `Hook event is not documented for ${evidence.host}; it never fires there.`,
      })
      continue
    }
    for (const group of Array.isArray(groups) ? groups : [groups]) {
      const fields = asRecord(group)
      if (fields === null) continue
      const matcher = fields['matcher']
      if (!spec.matcher && typeof matcher === 'string' && matcher !== '' && matcher !== '*') {
        findings.push({
          ...base,
          code: 'hook-matcher-ignored',
          status: 'warn',
          message: 'Matcher is set on an event without matcher support and is silently ignored.',
        })
      }
      const handlers = Array.isArray(fields['hooks'])
        ? (fields['hooks'] as unknown[])
        : fields['type'] !== undefined
          ? [fields]
          : []
      for (const handler of handlers) {
        const type = asRecord(handler)?.['type']
        if (typeof type !== 'string') continue
        if (!spec.handlers.includes(type as HandlerType)) {
          findings.push({
            ...base,
            code: 'hook-handler-unsupported',
            status: 'warn',
            message: `Handler type is not run for this event on ${evidence.host}; it is skipped.`,
          })
        }
      }
    }
  }
  return findings
}

function resolveCommandPaths(
  command: string,
  inventory: AgentConfigInventory,
  evidence: AgentConfigEvidence,
  exec = false,
): HookCommandPath[] | null {
  // Exec form spawns `command` directly as one executable, without a shell
  // (code.claude.com/docs/en/hooks, "Exec form and shell form").
  // Shell form: a word joins adjacent quoted and unquoted segments, so
  // `"$CLAUDE_PROJECT_DIR"/.claude/hooks/x.sh` is one path, not two tokens.
  const rawTokens = exec ? [command] : (command.match(/(?:"[^"]*"|'[^']*'|[^\s"']+)+/g) ?? [])
  const tokens = rawTokens.map((rawToken) => {
    let token = exec
      ? rawToken
      : rawToken.replace(/"([^"]*)"|'([^']*)'/g, (_, double, single) => double ?? single)
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
  // A variable other than CLAUDE_PROJECT_DIR, or a command substitution such
  // as `$(git rev-parse --show-toplevel)`, is only known at run time.
  const expands = (token: string): boolean => token.includes('$') || token.includes('`')
  const resolveToken = (token: string): string => {
    if (isAbsolute(token)) return token
    const boundary = evidence.scope === 'project' ? inventory.root : inventory.home
    return resolve(boundary, token)
  }

  let launcherIndex = 0
  const launcherPaths: HookCommandPath[] = []
  const first = tokens[0]
  if (first === undefined) return null
  if (exec) {
    const isPath = isAbsolute(first) || first.startsWith('./') || first.startsWith('../')
    return isPath ? [{ path: resolveToken(first), access: 'executable' }] : null
  }
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
        if (script === undefined || expands(script)) return null
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
      if (token.startsWith('-') || expands(token)) return null
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
    const parsed = parseHookCommands(evidence.path)
    if (parsed === null) {
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

    findings.push(...semanticFindings(parsed.hooks, evidence))

    for (const command of parsed.commands) {
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

      const commandPaths = resolveCommandPaths(command.command, inventory, evidence, command.exec)
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
