import { join } from 'node:path'
import type { AgentConfigRoot, AgentConfigScope } from '../types.js'

/** Returns Codex's known roots under the supplied scope boundary. */
export function resolveCodexRoots(scope: AgentConfigScope, boundary: string): AgentConfigRoot[] {
  const codexDir = join(boundary, '.codex')
  const roots: AgentConfigRoot[] = [
    { host: 'codex', scope, layer: 'instructions', path: join(codexDir, 'AGENTS.md'), boundary },
    { host: 'codex', scope, layer: 'skills', path: join(codexDir, 'skills'), boundary },
    { host: 'codex', scope, layer: 'agents', path: join(codexDir, 'agents'), boundary },
    { host: 'codex', scope, layer: 'hooks', path: join(codexDir, 'config.toml'), boundary },
    { host: 'codex', scope, layer: 'mcp', path: join(codexDir, 'config.toml'), boundary },
  ]

  if (scope === 'project') {
    roots.unshift({ host: 'codex', scope, layer: 'instructions', path: join(boundary, 'AGENTS.md'), boundary })
  }

  return roots
}
