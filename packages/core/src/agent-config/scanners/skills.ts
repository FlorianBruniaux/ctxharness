import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { load } from 'js-yaml'
import { isPathWithinBoundary } from '../inventory.js'
import type { AgentConfigEvidence, AgentConfigFinding, AgentConfigInventory } from '../types.js'

interface ParsedSkill {
  evidence: AgentConfigEvidence
  name?: string | undefined
  valid: boolean
  hasDescription: boolean
  missingReferences: string[]
  outsideReferences: string[]
}

function isReferenceOutsideSkillPackage(reference: string, skillPackage: string): boolean {
  const candidate = resolve(skillPackage, reference)
  if (!isPathWithinBoundary(skillPackage, candidate)) return true
  if (!existsSync(candidate)) return false

  try {
    return !isPathWithinBoundary(realpathSync(skillPackage), realpathSync(candidate))
  } catch {
    return false
  }
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

  const localReferences = [...referenced]
    .map((reference) => reference.split('#', 1)[0] ?? '')
    .filter((reference) => reference !== '')
  const skillPackage = dirname(evidence.path)
  const outsideReferences = localReferences.filter((reference) =>
    isReferenceOutsideSkillPackage(reference, skillPackage),
  )
  const missingReferences = localReferences.filter(
    (reference) =>
      !outsideReferences.includes(reference) && !existsSync(resolve(skillPackage, reference)),
  )

  // Claude Code defaults a skill's name to its directory name
  // (code.claude.com/docs/en/skills, frontmatter reference); Codex requires
  // both `name` and `description` in SKILL.md (Codex "Build skills" docs).
  const effectiveName =
    name ?? (evidence.host === 'claude' ? basename(dirname(evidence.path)) : undefined)
  // Claude Code only recommends `description` (it falls back to the first
  // body line), so its absence is a routing risk rather than a load failure.
  const valid = evidence.host === 'claude' || (name !== undefined && description !== undefined)

  return {
    evidence,
    name: effectiveName,
    valid,
    hasDescription: description !== undefined,
    missingReferences,
    outsideReferences,
  }
}

function skillFinding(skill: ParsedSkill): AgentConfigFinding {
  if (skill.valid && !skill.hasDescription) {
    return {
      code: 'skill-description-missing',
      status: 'warn',
      message:
        'Skill has no description; Claude Code falls back to the first body line for routing.',
      host: skill.evidence.host,
      scope: skill.evidence.scope,
      layer: 'skills',
      path: skill.evidence.path,
      evidence: [skill.evidence],
    }
  }
  return {
    code: skill.valid ? 'skill-valid' : 'skill-invalid',
    status: skill.valid ? 'pass' : 'fail',
    message: skill.valid
      ? 'Skill package has the metadata its host requires.'
      : skill.evidence.host === 'claude'
        ? 'Claude skill package metadata is invalid.'
        : 'Codex skill package requires non-empty name and description metadata.',
    host: skill.evidence.host,
    scope: skill.evidence.scope,
    layer: 'skills',
    path: skill.evidence.path,
    evidence: [skill.evidence],
  }
}

/** Validates skill manifests, local references, declared-name collisions, and provenance. */
export function scanSkills(inventory: AgentConfigInventory): AgentConfigFinding[] {
  const parsed: ParsedSkill[] = []
  const findings: AgentConfigFinding[] = []

  for (const skill of inventory.skills) {
    for (const evidence of skill.evidence) {
      try {
        parsed.push(parseSkill(evidence))
      } catch {
        findings.push({
          code: 'skill-evidence-unavailable',
          status: 'unknown',
          reason: 'missing-evidence',
          message: 'Skill manifest became unavailable after inventory.',
          host: evidence.host,
          scope: evidence.scope,
          layer: 'skills',
          path: evidence.path,
          evidence: [evidence],
        })
      }
    }
  }

  findings.push(...parsed.map(skillFinding))

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

  for (const skill of parsed) {
    if (skill.outsideReferences.length === 0) continue
    findings.push({
      code: 'skill-reference-outside-boundary',
      status: 'fail',
      reason: 'outside-boundary',
      message: `${skill.outsideReferences.length} referenced skill resource(s) escape the skill package boundary.`,
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
