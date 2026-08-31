import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { inventoryAgentConfig } from '../inventory.js'
import { scanInstructions } from '../scanners/instructions.js'
import { scanSkills } from '../scanners/skills.js'
import { scanRules } from '../scanners/rules.js'
import { scanAgents } from '../scanners/agents.js'
import { scanHooks } from '../scanners/hooks.js'
import { scanMcp } from '../scanners/mcp.js'
import { scanAgentConfig } from '../../scanners/index.js'
import type { AgentConfigFinding } from '../types.js'

const FIXTURES = join(import.meta.dirname, 'fixtures')
const PROJECT = join(FIXTURES, 'scanner-project')
const HOME = join(FIXTURES, 'scanner-home')

function inventory() {
  return inventoryAgentConfig({ root: PROJECT, home: HOME })
}

describe('AgentConfigFinding', () => {
  it('allows successful scanner findings without an unknown-state reason', () => {
    const finding: AgentConfigFinding = {
      code: 'instruction-valid',
      status: 'pass',
      message: 'Instruction file is readable and non-empty.',
    }

    expect(finding.reason).toBeUndefined()
  })
})

describe('scanInstructions', () => {
  it('discovers Claude project instructions and Codex project, nested, and global instructions', () => {
    const findings = scanInstructions(inventory())

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'instruction-valid',
          status: 'pass',
          host: 'claude',
          scope: 'project',
          path: join(PROJECT, 'CLAUDE.md'),
        }),
        expect.objectContaining({
          code: 'instruction-valid',
          status: 'pass',
          host: 'codex',
          scope: 'project',
          path: join(PROJECT, 'services', 'payments', 'AGENTS.override.md'),
        }),
        expect.objectContaining({
          code: 'instruction-valid',
          status: 'pass',
          host: 'codex',
          scope: 'global',
          path: join(HOME, '.codex', 'AGENTS.override.md'),
        }),
      ]),
    )
  })

  it('marks a same-directory AGENTS.md as shadowed by AGENTS.override.md', () => {
    const findings = scanInstructions(inventory())

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'instruction-shadowed',
        status: 'warn',
        host: 'codex',
        path: join(PROJECT, 'services', 'payments', 'AGENTS.md'),
      }),
    )
    expect(findings).not.toContainEqual(
      expect.objectContaining({
        code: 'instruction-valid',
        path: join(PROJECT, 'services', 'payments', 'AGENTS.md'),
      }),
    )
  })
})

describe('scanSkills', () => {
  it('validates packages and reports missing references with source provenance', () => {
    const findings = scanSkills(inventory())

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'skill-valid',
        status: 'pass',
        host: 'claude',
        path: join(PROJECT, '.claude', 'skills', 'review', 'SKILL.md'),
      }),
    )
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'skill-reference-missing',
        status: 'fail',
        host: 'claude',
        path: join(PROJECT, '.claude', 'skills', 'broken-reference', 'SKILL.md'),
        evidence: [
          expect.objectContaining({
            scope: 'project',
            path: join(PROJECT, '.claude', 'skills', 'broken-reference', 'SKILL.md'),
          }),
        ],
      }),
    )
  })

  it('rejects same-host skill name collisions and preserves every origin', () => {
    const findings = scanSkills(inventory())
    const collision = findings.find((finding) => finding.code === 'skill-name-collision')

    expect(collision).toEqual(
      expect.objectContaining({
        status: 'fail',
        host: 'claude',
        layer: 'skills',
      }),
    )
    expect(collision?.evidence).toEqual([
      expect.objectContaining({
        scope: 'project',
        path: join(PROJECT, '.claude', 'skills', 'review', 'SKILL.md'),
      }),
      expect.objectContaining({
        scope: 'global',
        path: join(HOME, '.claude', 'skills', 'review', 'SKILL.md'),
      }),
    ])
  })
})

describe('scanRules', () => {
  it('validates Claude project-relative path globs without treating Codex nested instructions as rules', () => {
    const findings = scanRules(inventory())

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'claude-rule-valid',
        status: 'pass',
        host: 'claude',
        path: join(PROJECT, '.claude', 'rules', 'api.md'),
      }),
    )
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'claude-rule-glob-invalid',
        status: 'fail',
        host: 'claude',
        path: join(PROJECT, '.claude', 'rules', 'outside.md'),
      }),
    )
    expect(findings.every((finding) => finding.host === 'claude')).toBe(true)
    expect(findings.some((finding) => finding.path?.endsWith('AGENTS.override.md'))).toBe(false)
  })
})

describe('scanAgents', () => {
  it('validates Claude Markdown and Codex TOML against their native required fields', () => {
    const findings = scanAgents(inventory())

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'agent-valid',
        status: 'pass',
        host: 'claude',
        path: join(PROJECT, '.claude', 'agents', 'reviewer.md'),
      }),
    )
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'agent-valid',
        status: 'pass',
        host: 'codex',
        path: join(PROJECT, '.codex', 'agents', 'reviewer.toml'),
      }),
    )
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'agent-invalid',
        status: 'fail',
        host: 'codex',
        path: join(PROJECT, '.codex', 'agents', 'claude-shaped.toml'),
      }),
    )
  })
})

describe('scanHooks', () => {
  it('parses Claude JSON plus Codex JSON and inline TOML declarations and reports unresolved command paths', () => {
    const findings = scanHooks(inventory())

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'hook-command-resolved',
        status: 'pass',
        host: 'claude',
        path: join(PROJECT, '.claude', 'settings.json'),
      }),
    )
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'hook-command-resolved',
        status: 'pass',
        host: 'codex',
        path: join(PROJECT, '.codex', 'config.toml'),
      }),
    )
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'hook-command-unresolved',
        status: 'fail',
        host: 'codex',
        path: join(PROJECT, '.codex', 'hooks.json'),
      }),
    )
  })

  it('discovers a global Codex hooks.json even when the sibling config.toml is absent', () => {
    const findings = scanHooks(inventory())

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'hook-command-resolved',
        status: 'pass',
        host: 'codex',
        scope: 'global',
        path: join(HOME, '.codex', 'hooks.json'),
      }),
    )
  })

  it('keeps a bare hook command unknown when static resolution evidence is unavailable', () => {
    const findings = scanHooks(inventory())

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'hook-command-unverified',
        status: 'unknown',
        reason: 'missing-evidence',
        host: 'codex',
        path: join(HOME, '.codex', 'hooks.json'),
      }),
    )
  })
})

describe('scanMcp', () => {
  it('parses Claude JSON and Codex TOML while redacting every literal secret value from findings', () => {
    const findings = scanMcp(inventory())

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'mcp-config-valid', status: 'pass', host: 'claude' }),
        expect.objectContaining({ code: 'mcp-literal-secret', status: 'fail', host: 'claude' }),
        expect.objectContaining({ code: 'mcp-config-valid', status: 'pass', host: 'codex' }),
        expect.objectContaining({ code: 'mcp-literal-secret', status: 'fail', host: 'codex' }),
      ]),
    )

    const output = JSON.stringify(findings)
    expect(output).not.toContain('claude-secret-should-never-appear')
    expect(output).not.toContain('codex-secret-should-never-appear')
    expect(output).not.toContain('codex-header-literal-should-never-appear')
    expect(
      findings.filter(
        (finding) => finding.host === 'codex' && finding.code === 'mcp-literal-secret',
      ),
    ).toHaveLength(2)
  })
})

describe('scanAgentConfig', () => {
  it('aggregates every host layer and preserves unknown inventory evidence', () => {
    const findings = scanAgentConfig(inventory())

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'configured-root-unavailable', status: 'unknown' }),
        expect.objectContaining({ code: 'instruction-valid', layer: 'instructions' }),
        expect.objectContaining({ code: 'skill-name-collision', layer: 'skills' }),
        expect.objectContaining({ code: 'claude-rule-valid', layer: 'rules' }),
        expect.objectContaining({ code: 'agent-valid', layer: 'agents' }),
        expect.objectContaining({ code: 'hook-command-unresolved', layer: 'hooks' }),
        expect.objectContaining({ code: 'mcp-literal-secret', layer: 'mcp' }),
      ]),
    )
  })
})
