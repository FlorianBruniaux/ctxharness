import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inventoryAgentConfig } from '../inventory.js'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctxharness-agent-config-'))
  tempDirs.push(dir)
  return dir
}

function writeFile(path: string, contents = ''): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents, 'utf-8')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('inventoryAgentConfig', () => {
  it('discovers Claude and Codex project configuration from the supplied root', () => {
    const project = makeTempDir()
    writeFile(join(project, 'CLAUDE.md'), '# project instructions')
    writeFile(join(project, '.codex', 'AGENTS.md'), '# project instructions')

    const inventory = inventoryAgentConfig({
      root: project,
      home: join(project, 'unused-home'),
      hosts: ['claude', 'codex'],
      scopes: ['project'],
    })

    expect(inventory.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          host: 'claude',
          scope: 'project',
          layer: 'instructions',
          path: join(project, 'CLAUDE.md'),
        }),
        expect.objectContaining({
          host: 'codex',
          scope: 'project',
          layer: 'instructions',
          path: join(project, '.codex', 'AGENTS.md'),
        }),
      ]),
    )
  })

  it('uses the injected home for global configuration and keeps duplicate skill provenance', () => {
    const project = makeTempDir()
    const home = makeTempDir()
    writeFile(join(project, '.claude', 'skills', 'review', 'SKILL.md'), '# project review skill')
    writeFile(join(home, '.claude', 'skills', 'review', 'SKILL.md'), '# global review skill')

    const inventory = inventoryAgentConfig({
      root: project,
      home,
      hosts: ['claude'],
      scopes: ['project', 'global'],
    })

    const reviewSkill = inventory.skills.find((skill) => skill.host === 'claude' && skill.name === 'review')
    expect(reviewSkill?.evidence).toEqual([
      expect.objectContaining({ scope: 'project', path: join(project, '.claude', 'skills', 'review', 'SKILL.md') }),
      expect.objectContaining({ scope: 'global', path: join(home, '.claude', 'skills', 'review', 'SKILL.md') }),
    ])
  })

  it('rejects a configured skill path that resolves outside the selected project boundary', () => {
    const project = makeTempDir()
    const outside = makeTempDir()
    writeFile(join(outside, 'escaped', 'SKILL.md'), '# outside skill')
    mkdirSync(join(project, '.claude', 'skills'), { recursive: true })
    symlinkSync(join(outside, 'escaped'), join(project, '.claude', 'skills', 'escaped'))

    const inventory = inventoryAgentConfig({
      root: project,
      home: join(project, 'unused-home'),
      hosts: ['claude'],
      scopes: ['project'],
    })

    expect(inventory.skills).toEqual([])
    expect(inventory.findings).toContainEqual(
      expect.objectContaining({
        code: 'path-outside-boundary',
        status: 'fail',
        path: join(project, '.claude', 'skills', 'escaped', 'SKILL.md'),
      }),
    )
  })
})
