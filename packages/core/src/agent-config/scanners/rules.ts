import { readFileSync, readdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { load } from 'js-yaml'
import type { AgentConfigEvidence, AgentConfigFinding, AgentConfigInventory } from '../types.js'

function markdownFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...markdownFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path)
  }
  return files
}

function validateRule(evidence: AgentConfigEvidence): AgentConfigFinding {
  const content = readFileSync(evidence.path, 'utf-8')
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  let invalid = false

  if (frontmatter !== null) {
    try {
      const parsed = load(frontmatter[1] ?? '')
      if (typeof parsed === 'object' && parsed !== null && 'paths' in parsed) {
        const paths = (parsed as Record<string, unknown>)['paths']
        invalid =
          !Array.isArray(paths) ||
          paths.length === 0 ||
          paths.some(
            (path) =>
              typeof path !== 'string' ||
              path.trim() === '' ||
              isAbsolute(path) ||
              path === '..' ||
              path.startsWith('../'),
          )
      }
    } catch {
      invalid = true
    }
  }

  return {
    code: invalid ? 'claude-rule-glob-invalid' : 'claude-rule-valid',
    status: invalid ? 'fail' : 'pass',
    message: invalid
      ? 'Claude rule paths must be non-empty project-relative glob strings.'
      : 'Claude rule uses valid project-relative path scope or is always loaded.',
    host: 'claude',
    scope: evidence.scope,
    layer: 'rules',
    path: evidence.path,
    evidence: [evidence],
  }
}

/** Validates Claude path-scoped rules. Codex directory scope is handled by scanInstructions. */
export function scanRules(inventory: AgentConfigInventory): AgentConfigFinding[] {
  return inventory.capabilities
    .filter((capability) => capability.host === 'claude' && capability.layer === 'rules')
    .flatMap((capability) =>
      markdownFiles(capability.path).map((path) =>
        validateRule({
          ...capability.evidence,
          path,
        }),
      ),
    )
}
