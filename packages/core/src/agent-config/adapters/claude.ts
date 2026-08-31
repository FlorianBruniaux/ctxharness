import { join } from 'node:path'
import type { AgentConfigRoot, AgentConfigScope } from '../types.js'

/** Returns Claude Code's known roots under the supplied scope boundary. */
export function resolveClaudeRoots(scope: AgentConfigScope, boundary: string): AgentConfigRoot[] {
  const claudeDir = join(boundary, '.claude')
  const roots: AgentConfigRoot[] = [
    { host: 'claude', scope, layer: 'instructions', path: join(claudeDir, 'CLAUDE.md'), boundary },
    { host: 'claude', scope, layer: 'skills', path: join(claudeDir, 'skills'), boundary },
    { host: 'claude', scope, layer: 'rules', path: join(claudeDir, 'rules'), boundary },
    { host: 'claude', scope, layer: 'agents', path: join(claudeDir, 'agents'), boundary },
    { host: 'claude', scope, layer: 'hooks', path: join(claudeDir, 'settings.json'), boundary },
    { host: 'claude', scope, layer: 'mcp', path: join(boundary, '.mcp.json'), boundary },
  ]

  if (scope === 'project') {
    roots.unshift({ host: 'claude', scope, layer: 'instructions', path: join(boundary, 'CLAUDE.md'), boundary })
  }

  if (scope === 'global') {
    roots.push({ host: 'claude', scope, layer: 'mcp', path: join(claudeDir, '.mcp.json'), boundary })
  }

  return roots
}
