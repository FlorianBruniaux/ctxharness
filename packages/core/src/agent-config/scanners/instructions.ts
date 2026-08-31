import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type {
  AgentConfigEvidence,
  AgentConfigFinding,
  AgentConfigInventory,
  AgentConfigScope,
} from '../types.js'

const CODEX_INSTRUCTION_NAMES = new Set(['AGENTS.md', 'AGENTS.override.md'])
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules'])

function instructionFinding(evidence: AgentConfigEvidence): AgentConfigFinding {
  const content = readFileSync(evidence.path, 'utf-8')
  const empty = content.trim().length === 0
  return {
    code: empty ? 'instruction-empty' : 'instruction-valid',
    status: empty ? 'fail' : 'pass',
    message: empty ? 'Instruction file is empty.' : 'Instruction file is readable and non-empty.',
    host: evidence.host,
    scope: evidence.scope,
    layer: 'instructions',
    path: evidence.path,
    evidence: [evidence],
  }
}

function discoverCodexInstructions(
  directory: string,
  scope: AgentConfigScope,
  boundary: string,
  recursive: boolean,
): AgentConfigEvidence[] {
  if (!existsSync(directory)) return []
  const evidence: AgentConfigEvidence[] = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && CODEX_INSTRUCTION_NAMES.has(entry.name)) {
      evidence.push({
        host: 'codex',
        scope,
        layer: 'instructions',
        root: boundary,
        path: join(directory, entry.name),
      })
      continue
    }
    if (recursive && entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
      evidence.push(
        ...discoverCodexInstructions(join(directory, entry.name), scope, boundary, true),
      )
    }
  }

  return evidence
}

/** Validates native instruction files without conflating Claude rules with Codex directory scope. */
export function scanInstructions(inventory: AgentConfigInventory): AgentConfigFinding[] {
  const discovered = inventory.capabilities
    .filter((capability) => capability.layer === 'instructions')
    .map((capability) => capability.evidence)

  discovered.push(...discoverCodexInstructions(inventory.root, 'project', inventory.root, true))
  discovered.push(
    ...discoverCodexInstructions(join(inventory.home, '.codex'), 'global', inventory.home, false),
  )

  const unique = new Map<string, AgentConfigEvidence>()
  for (const evidence of discovered) {
    const key = `${evidence.host}:${evidence.scope}:${evidence.path}`
    unique.set(key, evidence)
  }

  const evidence = [...unique.values()]
  return evidence.map((item) => {
    if (item.host !== 'codex' || basename(item.path) !== 'AGENTS.md')
      return instructionFinding(item)
    const override = evidence.find(
      (candidate) =>
        candidate.host === 'codex' &&
        candidate.scope === item.scope &&
        dirname(candidate.path) === dirname(item.path) &&
        basename(candidate.path) === 'AGENTS.override.md',
    )
    if (override === undefined) return instructionFinding(item)
    return {
      code: 'instruction-shadowed',
      status: 'warn',
      message: 'AGENTS.md is shadowed by AGENTS.override.md in the same directory.',
      host: 'codex',
      scope: item.scope,
      layer: 'instructions',
      path: item.path,
      evidence: [item, override],
    }
  })
}
