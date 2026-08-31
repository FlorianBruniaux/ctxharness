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

function malformedGlob(path: string): boolean {
  if (path.includes('\u0000') || path.split(/[\\/]/).includes('..')) return true

  const pairs: Record<string, string> = { '[': ']', '{': '}', '(': ')' }
  const stack: string[] = []
  let escaped = false
  for (const character of path) {
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character in pairs) stack.push(pairs[character]!)
    else if (stack.at(-1) === character) stack.pop()
    else if (character === ']' || character === '}' || character === ')') return true
  }
  return escaped || stack.length > 0
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
              malformedGlob(path),
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
  const findings: AgentConfigFinding[] = []
  for (const capability of inventory.capabilities.filter(
    (capability) => capability.host === 'claude' && capability.layer === 'rules',
  )) {
    try {
      for (const path of markdownFiles(capability.path)) {
        const evidence = {
          ...capability.evidence,
          path,
        }
        try {
          findings.push(validateRule(evidence))
        } catch {
          findings.push({
            code: 'rule-evidence-unavailable',
            status: 'unknown',
            reason: 'missing-evidence',
            message: 'Claude rule became unavailable after inventory.',
            host: evidence.host,
            scope: evidence.scope,
            layer: 'rules',
            path: evidence.path,
            evidence: [evidence],
          })
        }
      }
    } catch {
      findings.push({
        code: 'rule-evidence-unavailable',
        status: 'unknown',
        reason: 'missing-evidence',
        message: 'Claude rule directory became unavailable after inventory.',
        host: capability.host,
        scope: capability.scope,
        layer: 'rules',
        path: capability.path,
        evidence: [capability.evidence],
      })
    }
  }
  return findings
}
