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

function validClaudeAgent(content: string): boolean {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content)
  if (frontmatter === null || !nonEmptyString(frontmatter[2])) return false
  try {
    const parsed = load(frontmatter[1] ?? '')
    if (typeof parsed !== 'object' || parsed === null) return false
    const fields = parsed as Record<string, unknown>
    return nonEmptyString(fields['name']) && nonEmptyString(fields['description'])
  } catch {
    return false
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
  const valid = evidence.host === 'claude' ? validClaudeAgent(content) : validCodexAgent(content)
  return {
    code: valid ? 'agent-valid' : 'agent-invalid',
    status: valid ? 'pass' : 'fail',
    message: valid
      ? `Agent definition satisfies the native ${evidence.host} schema.`
      : `Agent definition is missing required native ${evidence.host} fields.`,
    host: evidence.host,
    scope: evidence.scope,
    layer: 'agents',
    path: evidence.path,
    evidence: [evidence],
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
