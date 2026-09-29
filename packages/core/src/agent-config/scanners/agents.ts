import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { parse as parseToml } from 'smol-toml'
import type { AgentConfigEvidence, AgentConfigFinding, AgentConfigInventory } from '../types.js'

function agentFiles(directory: string, extension: '.md' | '.toml'): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...agentFiles(path, extension))
    else if (entry.isFile() && entry.name.endsWith(extension)) files.push(path)
  }
  return files
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

type ClaudeAgentCheck = 'valid' | 'nonstrict' | 'documentation' | 'invalid'

/** Reads `key: value` lines at the top level when strict YAML rejects the block. */
function topLevelScalar(frontmatter: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(frontmatter)
  const value = match?.[1]?.trim().replace(/^['"]|['"]$/g, '')
  return value === undefined || value === '' ? undefined : value
}

/**
 * Claude Code requires only `name` and `description`; a file without `name`
 * is skipped as documentation (code.claude.com/docs/en/sub-agents, "Subagent
 * files Claude Code skips"). The body may be empty.
 */
function checkClaudeAgent(content: string): ClaudeAgentCheck {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
  if (frontmatter === null) return 'documentation'
  const block = frontmatter[1] ?? ''
  try {
    const parsed = load(block)
    if (typeof parsed !== 'object' || parsed === null) return 'documentation'
    const fields = parsed as Record<string, unknown>
    if (!nonEmptyString(fields['name'])) return 'documentation'
    return nonEmptyString(fields['description']) ? 'valid' : 'invalid'
  } catch {
    // Claude Code loads some frontmatter that strict YAML parsers reject, such as
    // unquoted descriptions containing `: `. Other tools may still reject it.
    if (topLevelScalar(block, 'name') === undefined) return 'invalid'
    return topLevelScalar(block, 'description') === undefined ? 'invalid' : 'nonstrict'
  }
}

function validCodexAgent(content: string): boolean {
  try {
    const parsed = parseToml(content) as Record<string, unknown>
    return (
      nonEmptyString(parsed['name']) &&
      nonEmptyString(parsed['description']) &&
      nonEmptyString(parsed['developer_instructions'])
    )
  } catch {
    return false
  }
}

function agentFinding(evidence: AgentConfigEvidence): AgentConfigFinding {
  const content = readFileSync(evidence.path, 'utf-8')
  const base = {
    host: evidence.host,
    scope: evidence.scope,
    layer: 'agents' as const,
    path: evidence.path,
    evidence: [evidence],
  }
  if (evidence.host === 'codex') {
    const valid = validCodexAgent(content)
    return {
      ...base,
      code: valid ? 'agent-valid' : 'agent-invalid',
      status: valid ? 'pass' : 'fail',
      message: valid
        ? 'Agent definition satisfies the native codex schema.'
        : 'Agent definition is missing required native codex fields.',
    }
  }

  switch (checkClaudeAgent(content)) {
    case 'valid':
      return {
        ...base,
        code: 'agent-valid',
        status: 'pass',
        message: 'Agent definition satisfies the native claude schema.',
      }
    case 'nonstrict':
      return {
        ...base,
        code: 'agent-frontmatter-nonstrict',
        status: 'warn',
        message:
          'Agent frontmatter declares name and description but is not strict YAML; other parsers may reject it.',
      }
    case 'documentation':
      return {
        ...base,
        code: 'agent-documentation',
        status: 'not-applicable',
        message: 'Markdown file has no agent name; Claude Code treats it as documentation.',
      }
    default:
      return {
        ...base,
        code: 'agent-invalid',
        status: 'fail',
        message: 'Agent definition is missing required native claude fields.',
      }
  }
}

/** Validates Claude Markdown and Codex TOML agents independently. */
export function scanAgents(inventory: AgentConfigInventory): AgentConfigFinding[] {
  const findings: AgentConfigFinding[] = []
  for (const capability of inventory.capabilities.filter(
    (candidate) => candidate.layer === 'agents',
  )) {
    const extension = capability.host === 'claude' ? ('.md' as const) : ('.toml' as const)
    try {
      for (const path of agentFiles(capability.path, extension)) {
        const evidence = {
          ...capability.evidence,
          path,
        }
        try {
          findings.push(agentFinding(evidence))
        } catch {
          findings.push({
            code: 'agent-evidence-unavailable',
            status: 'unknown',
            reason: 'missing-evidence',
            message: 'Agent definition became unavailable after inventory.',
            host: evidence.host,
            scope: evidence.scope,
            layer: 'agents',
            path: evidence.path,
            evidence: [evidence],
          })
        }
      }
    } catch {
      findings.push({
        code: 'agent-evidence-unavailable',
        status: 'unknown',
        reason: 'missing-evidence',
        message: 'Agent directory became unavailable after inventory.',
        host: capability.host,
        scope: capability.scope,
        layer: 'agents',
        path: capability.path,
        evidence: [capability.evidence],
      })
    }
  }
  return findings
}
