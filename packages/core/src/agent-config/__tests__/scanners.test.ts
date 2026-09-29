import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execPath } from 'node:process'
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
const tempDirs: string[] = []

function makeTempDir(): string {
  const path = mkdtempSync(join(tmpdir(), 'ctxharness-scanners-'))
  tempDirs.push(path)
  return path
}

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf-8')
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

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

  it('requires a reason for unknown findings', () => {
    const finding: AgentConfigFinding = {
      code: 'configured-root-unavailable',
      status: 'unknown',
      reason: 'missing-evidence',
      message: 'Configured root is unavailable.',
    }

    expect(finding.reason).toBe('missing-evidence')

    // @ts-expect-error Unknown findings must state why their evidence is unavailable.
    const missingReason: AgentConfigFinding = {
      code: 'configured-root-unavailable',
      status: 'unknown',
      message: 'Configured root is unavailable.',
    }
    expect(missingReason.status).toBe('unknown')
  })
})

describe('scanInstructions', () => {
  it.each([
    { label: 'Claude-only', hosts: ['claude'] as const, scopes: ['project', 'global'] as const },
    { label: 'Codex-only', hosts: ['codex'] as const, scopes: ['project', 'global'] as const },
  ])('honors the $label host selection from inventory', ({ hosts, scopes }) => {
    const findings = scanInstructions(
      inventoryAgentConfig({ root: PROJECT, home: HOME, hosts: [...hosts], scopes: [...scopes] }),
    )

    expect(findings.length).toBeGreaterThan(0)
    expect(findings.every((finding) => finding.host === hosts[0])).toBe(true)
  })

  it.each([
    { label: 'project-only', scopes: ['project'] as const },
    { label: 'global-only', scopes: ['global'] as const },
  ])('honors the $label scope selection from inventory', ({ scopes }) => {
    const findings = scanInstructions(
      inventoryAgentConfig({
        root: PROJECT,
        home: HOME,
        hosts: ['claude', 'codex'],
        scopes: [...scopes],
      }),
    )

    expect(findings.length).toBeGreaterThan(0)
    expect(findings.every((finding) => finding.scope === scopes[0])).toBe(true)
  })

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

  it('rejects references that escape the skill package lexically or through a symlink', () => {
    const findings = scanSkills(inventory())
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'skill-reference-outside-boundary',
          path: join(PROJECT, '.claude', 'skills', 'absolute-reference', 'SKILL.md'),
        }),
        expect.objectContaining({
          code: 'skill-reference-outside-boundary',
          path: join(PROJECT, '.claude', 'skills', 'parent-reference', 'SKILL.md'),
        }),
      ]),
    )

    const project = makeTempDir()
    const home = makeTempDir()
    const packageDir = join(project, '.claude', 'skills', 'symlinked')
    const outside = join(makeTempDir(), 'outside.md')
    writeFile(
      join(packageDir, 'SKILL.md'),
      '---\nname: symlinked\ndescription: test\n---\n[escape](link.md)',
    )
    writeFile(outside, 'outside')
    symlinkSync(outside, join(packageDir, 'link.md'))

    expect(
      scanSkills(inventoryAgentConfig({ root: project, home, hosts: ['claude'] })),
    ).toContainEqual(
      expect.objectContaining({
        code: 'skill-reference-outside-boundary',
        path: join(packageDir, 'SKILL.md'),
      }),
    )
  })
})

describe('scanSkills native name requirements', () => {
  it('accepts a Claude skill without name because the directory name supplies it', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    const manifest = join(project, '.claude', 'skills', 'unnamed', 'SKILL.md')
    writeFile(manifest, '---\ndescription: test\n---\nbody')

    const findings = scanSkills(
      inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
    )

    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'skill-valid', status: 'pass', path: manifest }),
    )
    expect(findings.some((finding) => finding.code === 'skill-invalid')).toBe(false)
  })

  it('warns instead of failing when a Claude skill has no description', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    const manifest = join(project, '.claude', 'skills', 'bare', 'SKILL.md')
    writeFile(manifest, '---\nname: bare\n---\nFirst line used as description.')

    const findings = scanSkills(
      inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
    )

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'skill-description-missing',
        status: 'warn',
        path: manifest,
      }),
    )
    expect(findings.some((finding) => finding.status === 'fail')).toBe(false)
  })

  it('rejects a Codex skill without name because Codex requires it', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    const manifest = join(project, '.agents', 'skills', 'unnamed', 'SKILL.md')
    writeFile(manifest, '---\ndescription: test\n---\nbody')

    const findings = scanSkills(
      inventoryAgentConfig({ root: project, home, hosts: ['codex'], scopes: ['project'] }),
    )

    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'skill-invalid', status: 'fail', path: manifest }),
    )
  })

  it('detects Claude collisions on the effective name when one skill omits name', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    writeFile(
      join(project, '.claude', 'skills', 'deploy', 'SKILL.md'),
      '---\ndescription: a\n---\n',
    )
    writeFile(
      join(project, '.claude', 'skills', 'other', 'SKILL.md'),
      '---\nname: deploy\ndescription: b\n---\n',
    )

    const findings = scanSkills(
      inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
    )

    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'skill-name-collision', host: 'claude' }),
    )
  })
})

describe('scanRules native frontmatter', () => {
  it('accepts paths written as a comma-separated string', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    const rule = join(project, '.claude', 'rules', 'comma.md')
    writeFile(rule, '---\npaths: "src/**/*.ts, lib/**/*.ts"\n---\n# Rule')

    const findings = scanRules(
      inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
    )

    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'claude-rule-valid', status: 'pass', path: rule }),
    )
  })

  it('still rejects a comma-separated string containing a malformed glob', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    const rule = join(project, '.claude', 'rules', 'comma-bad.md')
    writeFile(rule, '---\npaths: "src/**/*.ts, lib/[oops"\n---\n# Rule')

    const findings = scanRules(
      inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
    )

    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'claude-rule-glob-invalid', status: 'fail', path: rule }),
    )
  })

  it('warns instead of failing when the frontmatter YAML does not parse', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    const rule = join(project, '.claude', 'rules', 'broken.md')
    writeFile(rule, '---\npaths: [unclosed\n---\n# Rule')

    const findings = scanRules(
      inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
    )

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'claude-rule-frontmatter-invalid',
        status: 'warn',
        path: rule,
      }),
    )
    expect(findings.some((finding) => finding.status === 'fail')).toBe(false)
  })
})

describe('scanAgents native frontmatter', () => {
  it('accepts a Claude agent with name and description and an empty body', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    const agent = join(project, '.claude', 'agents', 'empty-body.md')
    writeFile(agent, '---\nname: empty-body\ndescription: test\n---\n')

    const findings = scanAgents(
      inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
    )

    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'agent-valid', status: 'pass', path: agent }),
    )
  })

  it('warns when strict YAML fails but top-level name and description lines exist', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    const agent = join(project, '.claude', 'agents', 'lenient.md')
    writeFile(
      agent,
      '---\nname: lenient\ndescription: Use this agent when X. Examples: <example>user: "hi" assistant: "ok"</example>\nmodel: sonnet\n---\nbody',
    )

    const findings = scanAgents(
      inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
    )

    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'agent-frontmatter-nonstrict', status: 'warn', path: agent }),
    )
    expect(findings.some((finding) => finding.status === 'fail')).toBe(false)
  })

  it('treats a Claude Markdown file without name as documentation, not a failure', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    const readme = join(project, '.claude', 'agents', 'README.md')
    writeFile(readme, '# Agents\n\nNotes for maintainers.')

    const findings = scanAgents(
      inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
    )

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'agent-documentation',
        status: 'not-applicable',
        path: readme,
      }),
    )
    expect(findings.some((finding) => finding.status === 'fail')).toBe(false)
  })

  it('still rejects a Claude agent with name but no description', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    const agent = join(project, '.claude', 'agents', 'nodesc.md')
    writeFile(agent, '---\nname: nodesc\n---\nbody')

    const findings = scanAgents(
      inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
    )

    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'agent-invalid', status: 'fail', path: agent }),
    )
  })
})

describe('scanHooks native event semantics', () => {
  function claudeHooks(hooks: unknown) {
    const project = makeTempDir()
    const home = makeTempDir()
    writeFile(join(project, '.claude', 'settings.json'), JSON.stringify({ hooks }))
    return scanHooks(
      inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
    )
  }

  function codexHooks(hooks: unknown) {
    const project = makeTempDir()
    const home = makeTempDir()
    writeFile(join(project, '.codex', 'config.toml'), '')
    writeFile(join(project, '.codex', 'hooks.json'), JSON.stringify({ hooks }))
    return scanHooks(
      inventoryAgentConfig({ root: project, home, hosts: ['codex'], scopes: ['project'] }),
    )
  }

  const echo = { type: 'command', command: '/bin/echo' }

  it('accepts the recently documented Claude events', () => {
    const findings = claudeHooks({
      DirectoryAdded: [{ hooks: [echo] }],
      PreModelSwitch: [{ hooks: [echo] }],
      PostModelSwitch: [{ hooks: [echo] }],
    })

    expect(findings.some((finding) => finding.code === 'hook-event-unknown')).toBe(false)
  })

  it('warns on an unknown Claude event name', () => {
    expect(claudeHooks({ PreToolCall: [{ hooks: [echo] }] })).toContainEqual(
      expect.objectContaining({ code: 'hook-event-unknown', status: 'warn', host: 'claude' }),
    )
  })

  it('warns on a Claude-only event configured for Codex', () => {
    expect(codexHooks({ PostToolBatch: [{ hooks: [echo] }] })).toContainEqual(
      expect.objectContaining({ code: 'hook-event-unknown', status: 'warn', host: 'codex' }),
    )
  })

  it('does not treat the Codex hooks.state trust registry as an event', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    writeFile(
      join(project, '.codex', 'config.toml'),
      '[hooks.state."abc"]\nenabled = true\ntrusted_hash = "sha256:0"\n',
    )

    const findings = scanHooks(
      inventoryAgentConfig({ root: project, home, hosts: ['codex'], scopes: ['project'] }),
    )

    expect(findings.some((finding) => finding.code === 'hook-event-unknown')).toBe(false)
  })

  it('accepts the Codex Interrupt event', () => {
    expect(
      codexHooks({ Interrupt: [{ hooks: [echo] }] }).some(
        (finding) => finding.code === 'hook-event-unknown',
      ),
    ).toBe(false)
  })

  it('warns on a matcher configured for an event without matcher support', () => {
    expect(claudeHooks({ UserPromptSubmit: [{ matcher: 'Bash', hooks: [echo] }] })).toContainEqual(
      expect.objectContaining({ code: 'hook-matcher-ignored', status: 'warn' }),
    )
    expect(codexHooks({ Stop: [{ matcher: 'x', hooks: [echo] }] })).toContainEqual(
      expect.objectContaining({ code: 'hook-matcher-ignored', status: 'warn' }),
    )
  })

  it('warns on handler types the event does not run', () => {
    expect(
      claudeHooks({ PermissionRequest: [{ hooks: [{ type: 'agent', prompt: 'check' }] }] }),
    ).toContainEqual(expect.objectContaining({ code: 'hook-handler-unsupported', status: 'warn' }))
    expect(
      claudeHooks({ SessionStart: [{ hooks: [{ type: 'http', url: 'https://x.test' }] }] }),
    ).toContainEqual(expect.objectContaining({ code: 'hook-handler-unsupported', status: 'warn' }))
    expect(codexHooks({ Stop: [{ hooks: [{ type: 'prompt', prompt: 'check' }] }] })).toContainEqual(
      expect.objectContaining({ code: 'hook-handler-unsupported', status: 'warn' }),
    )
  })

  it('does not report supported http and mcp_tool handlers as invalid commands', () => {
    const findings = claudeHooks({
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            { type: 'http', url: 'https://x.test' },
            { type: 'mcp_tool', server: 'memory', tool: 'check' },
          ],
        },
      ],
    })

    expect(findings.some((finding) => finding.status === 'fail')).toBe(false)
    expect(findings.some((finding) => finding.code === 'hook-handler-unsupported')).toBe(false)
  })

  it('resolves an exec-form command as one executable token, not a shell string', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    const script = join(project, '.claude', 'hooks', 'with space.sh')
    writeFile(script, '#!/bin/sh\n')
    chmodSync(script, 0o755)
    writeFile(
      join(project, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            { hooks: [{ type: 'command', command: script, args: ['--flag', 'value'] }] },
          ],
        },
      }),
    )

    const findings = scanHooks(
      inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
    )

    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'hook-command-resolved', status: 'pass' }),
    )
  })

  it('keeps a bare exec-form executable unverified because it resolves on PATH', () => {
    expect(
      claudeHooks({
        PostToolUse: [{ hooks: [{ type: 'command', command: 'node', args: ['x.mjs'] }] }],
      }),
    ).toContainEqual(
      expect.objectContaining({ code: 'hook-command-unverified', status: 'unknown' }),
    )
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

  it('rejects embedded parent traversal and malformed globs', () => {
    const findings = scanRules(inventory())

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'claude-rule-glob-invalid',
          path: join(PROJECT, '.claude', 'rules', 'embedded-traversal.md'),
        }),
        expect.objectContaining({
          code: 'claude-rule-glob-invalid',
          path: join(PROJECT, '.claude', 'rules', 'malformed.md'),
        }),
      ]),
    )
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
  it('rejects a missing bare relative script after env and a recognized interpreter', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    writeFile(
      join(project, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              hooks: [
                {
                  type: 'command',
                  command: '/usr/bin/env node missing.mjs',
                },
              ],
            },
          ],
        },
      }),
    )

    const findings = scanHooks(
      inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
    )

    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'hook-command-unresolved', status: 'fail' }),
    )
  })

  it('rejects a missing bare relative script after an absolute recognized interpreter', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    writeFile(
      join(project, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              hooks: [
                {
                  type: 'command',
                  command: `"${execPath}" missing.mjs`,
                },
              ],
            },
          ],
        },
      }),
    )

    const findings = scanHooks(
      inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
    )

    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'hook-command-unresolved', status: 'fail' }),
    )
  })

  it('keeps a recognized interpreter without a script candidate UNKNOWN', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    writeFile(
      join(project, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              hooks: [
                {
                  type: 'command',
                  command: '/usr/bin/env node',
                },
              ],
            },
          ],
        },
      }),
    )

    const findings = scanHooks(
      inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
    )

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'hook-command-unverified',
        status: 'unknown',
        reason: 'missing-evidence',
      }),
    )
  })

  it('resolves the interpreter after env -u and rejects its missing script', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    writeFile(
      join(project, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              hooks: [
                {
                  type: 'command',
                  command: '/usr/bin/env -u NODE_OPTIONS node "./.claude/hooks/missing.mjs"',
                },
              ],
            },
          ],
        },
      }),
    )

    const findings = scanHooks(
      inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
    )

    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'hook-command-unresolved', status: 'fail' }),
    )
  })

  it('keeps a grouped env -S command UNKNOWN instead of validating env alone', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    writeFile(
      join(project, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              hooks: [
                {
                  type: 'command',
                  command: '/usr/bin/env -S "node ./.claude/hooks/missing.mjs"',
                },
              ],
            },
          ],
        },
      }),
    )

    const findings = scanHooks(
      inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
    )

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'hook-command-unverified',
        status: 'unknown',
        reason: 'missing-evidence',
      }),
    )
  })

  it('rejects a missing interpreter script after a readable path-valued option', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    const loader = join(project, '.claude', 'hooks', 'loader.mjs')
    writeFile(loader, '# fixture loader\n')
    chmodSync(loader, 0o644)
    writeFile(
      join(project, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              hooks: [
                {
                  type: 'command',
                  command:
                    'node --require "./.claude/hooks/loader.mjs" "./.claude/hooks/missing.mjs"',
                },
              ],
            },
          ],
        },
      }),
    )

    const findings = scanHooks(
      inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
    )

    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'hook-command-unresolved', status: 'fail' }),
    )
  })

  it.each([
    {
      label: 'missing script after /usr/bin/env node',
      command: '/usr/bin/env node "./.claude/hooks/missing.mjs"',
      script: undefined,
      mode: undefined,
      expectedCode: 'hook-command-unresolved',
      expectedStatus: 'fail',
    },
    {
      label: 'readable node script',
      command: 'node "./.claude/hooks/readable.mjs"',
      script: '.claude/hooks/readable.mjs',
      mode: 0o644,
      expectedCode: 'hook-command-resolved',
      expectedStatus: 'pass',
    },
    {
      label: 'readable bash script',
      command: "bash './.claude/hooks/readable.sh'",
      script: '.claude/hooks/readable.sh',
      mode: 0o644,
      expectedCode: 'hook-command-resolved',
      expectedStatus: 'pass',
    },
    {
      label: 'quoted script path after /usr/bin/env',
      command: '/usr/bin/env node "./.claude/hooks/quoted script.mjs"',
      script: '.claude/hooks/quoted script.mjs',
      mode: 0o644,
      expectedCode: 'hook-command-resolved',
      expectedStatus: 'pass',
    },
    {
      label: 'executable direct hook',
      command: './.claude/hooks/direct.sh',
      script: '.claude/hooks/direct.sh',
      mode: 0o755,
      expectedCode: 'hook-command-resolved',
      expectedStatus: 'pass',
    },
    {
      label: 'non-executable direct hook',
      command: './.claude/hooks/direct.sh',
      script: '.claude/hooks/direct.sh',
      mode: 0o644,
      expectedCode: 'hook-command-unresolved',
      expectedStatus: 'fail',
    },
  ])(
    'validates the $label with launcher-aware semantics',
    ({ command, script, mode, expectedCode, expectedStatus }) => {
      const project = makeTempDir()
      const home = makeTempDir()
      writeFile(
        join(project, '.claude', 'settings.json'),
        JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: 'command', command }] }] } }),
      )
      if (script !== undefined && mode !== undefined) {
        const scriptPath = join(project, script)
        writeFile(scriptPath, '# fixture hook\n')
        chmodSync(scriptPath, mode)
      }

      const findings = scanHooks(
        inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
      )

      expect(findings).toContainEqual(
        expect.objectContaining({ code: expectedCode, status: expectedStatus }),
      )
    },
  )

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

  it('rejects malformed command declarations in JSON and TOML', () => {
    const findings = scanHooks(inventory())

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'hook-command-invalid',
          status: 'fail',
          host: 'claude',
          path: join(PROJECT, '.claude', 'settings.json'),
        }),
        expect.objectContaining({
          code: 'hook-command-invalid',
          status: 'fail',
          host: 'codex',
          path: join(PROJECT, '.codex', 'config.toml'),
        }),
      ]),
    )
  })

  it('does not parse an adjacent hooks.json symlink outside the selected boundary', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    const externalHooks = join(makeTempDir(), 'hooks.json')
    writeFile(join(project, '.codex', 'config.toml'), '')
    writeFile(
      externalHooks,
      '{"hooks":{"SessionStart":[{"type":"command","command":"./outside.sh"}]}}',
    )
    symlinkSync(externalHooks, join(project, '.codex', 'hooks.json'))

    const findings = scanHooks(inventoryAgentConfig({ root: project, home, hosts: ['codex'] }))
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'hook-source-outside-boundary',
        status: 'fail',
        path: join(project, '.codex', 'hooks.json'),
      }),
    )
    expect(findings.some((finding) => finding.path === externalHooks)).toBe(false)
  })
})

describe('scanMcp', () => {
  it('rejects inline option and environment-assignment secrets without serializing values', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    const inlineSecret = 'inline-sensitive-fragment'
    const assignmentSecret = 'assignment-sensitive-fragment'
    writeFile(
      join(project, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          inline: { command: 'example-mcp', args: [`--api-key=${inlineSecret}`] },
          assignment: { command: 'example-mcp', args: [`API_TOKEN=${assignmentSecret}`] },
        },
      }),
    )

    const findings = scanMcp(
      inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
    )
    const output = JSON.stringify(findings)

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'mcp-literal-secret', server: 'inline' }),
        expect.objectContaining({ code: 'mcp-literal-secret', server: 'assignment' }),
      ]),
    )
    expect(output).not.toContain(inlineSecret)
    expect(output).not.toContain(assignmentSecret)
  })

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
    ).toHaveLength(3)
    expect(
      findings.filter((finding) => finding.layer === 'mcp').map((finding) => finding.server),
    ).toEqual(expect.arrayContaining(['safe', 'literal', 'fallback']))
  })

  it('rejects literal fallbacks in JSON and TOML environment substitutions without serializing them', () => {
    const findings = scanMcp(inventory())
    const output = JSON.stringify(findings)

    expect(
      findings.filter(
        (finding) => finding.code === 'mcp-literal-secret' && finding.server === 'fallback',
      ),
    ).toHaveLength(2)
    expect(output).not.toContain('json-fallback-should-never-appear')
    expect(output).not.toContain('toml-fallback-should-never-appear')
  })

  it('replaces a credential-like server key with a deterministic non-secret identifier', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    const secretBearingKey = 'token-round2-sensitive-fragment'
    writeFile(
      join(project, '.mcp.json'),
      JSON.stringify({ mcpServers: { [secretBearingKey]: { url: 'https://mcp.example.test' } } }),
    )

    const findings = scanMcp(
      inventoryAgentConfig({ root: project, home, hosts: ['claude'], scopes: ['project'] }),
    )
    const output = JSON.stringify(findings)

    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'mcp-config-valid', server: 'server-1' }),
    )
    expect(output).not.toContain(secretBearingKey)
    expect(output).not.toContain('round2-sensitive-fragment')
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

  it('preserves aggregation when inventory evidence disappears before each post-inventory scanner reads it', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    writeFile(join(project, 'CLAUDE.md'), '# instructions')
    writeFile(
      join(project, '.claude', 'skills', 'demo', 'SKILL.md'),
      '---\nname: demo\ndescription: test\n---',
    )
    writeFile(join(project, '.claude', 'rules', 'demo.md'), '# rule')
    writeFile(
      join(project, '.claude', 'agents', 'demo.md'),
      '---\nname: demo\ndescription: test\n---\nbody',
    )
    const beforeRemoval = inventoryAgentConfig({
      root: project,
      home,
      hosts: ['claude'],
      scopes: ['project'],
    })

    rmSync(join(project, 'CLAUDE.md'))
    rmSync(join(project, '.claude', 'skills', 'demo', 'SKILL.md'))
    rmSync(join(project, '.claude', 'rules'), { recursive: true })
    rmSync(join(project, '.claude', 'agents'), { recursive: true })

    const findings = scanAgentConfig(beforeRemoval)
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'unknown',
          layer: 'instructions',
          reason: 'missing-evidence',
        }),
        expect.objectContaining({ status: 'unknown', layer: 'skills', reason: 'missing-evidence' }),
        expect.objectContaining({ status: 'unknown', layer: 'rules', reason: 'missing-evidence' }),
        expect.objectContaining({ status: 'unknown', layer: 'agents', reason: 'missing-evidence' }),
      ]),
    )
  })
})
