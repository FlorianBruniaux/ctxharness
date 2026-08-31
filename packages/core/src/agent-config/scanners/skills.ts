import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { load } from 'js-yaml'
import type { AgentConfigEvidence, AgentConfigFinding, AgentConfigInventory } from '../types.js'

interface ParsedSkill {
  evidence: AgentConfigEvidence
  name?: string | undefined
  valid: boolean
  missingReferences: string[]
}

function parseSkill(evidence: AgentConfigEvidence): ParsedSkill {
  const content = readFileSync(evidence.path, 'utf-8')
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  let name: string | undefined
  let description: string | undefined

  if (frontmatter !== null) {
    try {
      const parsed = load(frontmatter[1] ?? '')
      if (typeof parsed === 'object' && parsed !== null) {
        const fields = parsed as Record<string, unknown>
        if (typeof fields['name'] === 'string' && fields['name'].trim() !== '')
          name = fields['name']
        if (typeof fields['description'] === 'string' && fields['description'].trim() !== '') {
          description = fields['description']
        }
      }
    } catch {
      // Invalid YAML is represented by valid=false below.
    }
  }

  const referenced = new Set<string>()
  const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g
  const atReference = /(?:^|\s)@([\w./-]+)/gm
  let match: RegExpExecArray | null
  while ((match = markdownLink.exec(content)) !== null) {
    const target = match[1]?.trim()
    if (target && !target.startsWith('#') && !/^[a-z]+:/i.test(target)) referenced.add(target)
  }
  while ((match = atReference.exec(content)) !== null) {
    if (match[1]) referenced.add(match[1])
  }

  const missingReferences = [...referenced]
    .map((reference) => reference.split('#', 1)[0] ?? '')
    .filter(
      (reference) => reference !== '' && !existsSync(resolve(dirname(evidence.path), reference)),
    )

  return {
    evidence,
    name,
    valid: name !== undefined && description !== undefined,
    missingReferences,
  }
}

function skillFinding(skill: ParsedSkill): AgentConfigFinding {
  return {
    code: skill.valid ? 'skill-valid' : 'skill-invalid',
    status: skill.valid ? 'pass' : 'fail',
    message: skill.valid
      ? 'Skill package has required name and description metadata.'
      : 'Skill package requires non-empty name and description metadata.',
    host: skill.evidence.host,
    scope: skill.evidence.scope,
    layer: 'skills',
    path: skill.evidence.path,
    evidence: [skill.evidence],
  }
}

/** Validates skill manifests, local references, declared-name collisions, and provenance. */
export function scanSkills(inventory: AgentConfigInventory): AgentConfigFinding[] {
  const parsed = inventory.skills.flatMap((skill) => skill.evidence.map(parseSkill))
  const findings = parsed.map(skillFinding)

  for (const skill of parsed) {
    if (skill.missingReferences.length === 0) continue
    findings.push({
      code: 'skill-reference-missing',
      status: 'fail',
      message: `${skill.missingReferences.length} referenced skill resource(s) are unavailable.`,
      host: skill.evidence.host,
      scope: skill.evidence.scope,
      layer: 'skills',
      path: skill.evidence.path,
      evidence: [skill.evidence],
    })
  }

  const byDeclaredName = new Map<string, ParsedSkill[]>()
  for (const skill of parsed) {
    if (skill.name === undefined) continue
    const key = `${skill.evidence.host}:${skill.name}`
    const matches = byDeclaredName.get(key) ?? []
    matches.push(skill)
    byDeclaredName.set(key, matches)
  }

  for (const matches of byDeclaredName.values()) {
    if (matches.length < 2) continue
    findings.push({
      code: 'skill-name-collision',
      status: 'fail',
      message: 'Multiple skill packages declare the same name for one host.',
      host: matches[0]!.evidence.host,
      layer: 'skills',
      evidence: matches.map((match) => match.evidence),
    })
  }

  return findings
}
