import { afterEach, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import * as core from '../../index.js'
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ctx-budget-'))
  dirs.push(root)
  return root
}
function budget(root: string, limits: object = {}) {
  const fn = Reflect.get(core, 'buildStaticBudget') as (
    inventory: unknown,
    limits: object,
  ) => {
    complete: boolean
    totals: { utf8Bytes: number; utf16CodeUnits: number; estimatedTokens: number }
    files: { path: string; contentGroup: string; segments: { category: string }[] }[]
    edges: { status: string }[]
  }
  expect(fn).toBeTypeOf('function')
  return fn(
    core.inventoryAgentConfig({ root, home: root, hosts: ['claude'], scopes: ['project'] }),
    limits,
  )
}
it('labels exact UTF-8 bytes separately from the historical UTF-16 chars/4 estimate', () => {
  const root = fixture()
  write(join(root, 'CLAUDE.md'), 'é😊')
  expect(budget(root).totals).toEqual({ utf8Bytes: 6, utf16CodeUnits: 3, estimatedTokens: 1 })
})
it('deduplicates physical files while retaining edges and distinct equal content', () => {
  const root = fixture()
  write(join(root, 'CLAUDE.md'), '@a.md @alias.md @b.md')
  write(join(root, 'a.md'), 'same')
  write(join(root, 'b.md'), 'same')
  symlinkSync(join(root, 'a.md'), join(root, 'alias.md'))
  const b = budget(root)
  expect(b.files).toHaveLength(3)
  expect(b.files[1]?.contentGroup).toBe(b.files[2]?.contentGroup)
  expect(b.edges.filter((e) => e.status === 'duplicate')).toHaveLength(1)
  expect(b.totals).toEqual({ utf8Bytes: 29, utf16CodeUnits: 29, estimatedTokens: 8 })
})
it('separates conditional rules, skill metadata/body and discoverable MCP metadata', () => {
  const root = fixture()
  write(join(root, '.claude/rules/rare.md'), '---\npaths: ["rare/**"]\n---\nFrench français')
  write(
    join(root, '.claude/skills/review/SKILL.md'),
    '---\nname: review\ndescription: Review code\n---\nBody code const x = 1',
  )
  write(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { fixture: { command: 'inert' } } }))
  const categories = budget(root).files.flatMap((f) => f.segments.map((s) => s.category))
  expect(categories).toContain('conditional-rule')
  expect(categories).toContain('skill-catalog-metadata')
  expect(categories).toContain('skill-body')
  expect(categories).toContain('mcp-discoverable-metadata')
})
it('marks cycles, unavailable imports and caps honestly without manufacturing savings', () => {
  const root = fixture()
  write(join(root, 'CLAUDE.md'), '@a.md @missing.md')
  write(join(root, 'a.md'), '@CLAUDE.md')
  const b = budget(root)
  expect(b.complete).toBe(false)
  expect(b.edges.some((e) => e.status === 'duplicate')).toBe(true)
  expect(b.edges.some((e) => e.status === 'unavailable')).toBe(true)
  expect(budget(root, { maxFiles: 1 }).edges.some((e) => e.status === 'file-limit')).toBe(true)
  expect(budget(root, { maxBytes: 1 }).edges.some((e) => e.status === 'byte-limit')).toBe(true)
  expect(budget(root, { maxDepth: 1 }).edges.some((e) => e.status === 'depth-limit')).toBe(true)
})
it('keeps portable measurements path-free and rejects inconsistent totals', () => {
  const root = fixture()
  write(join(root, 'CLAUDE.md'), 'é😊')
  const report = core.buildAgentDoctorReport({
    root,
    home: root,
    hosts: ['claude'],
    scopes: ['project'],
    includeBudget: true,
  })
  const portable = core.projectPortableReport(report)
  expect(portable.budget?.methods.estimate).toBe('utf16-code-units-div-4-ceil')
  expect(portable.budget?.totals.utf8Bytes).toBe(6)
  expect(JSON.stringify(portable)).not.toContain(root)
  expect(JSON.stringify(portable)).not.toContain('contentDigest')
  expect(() =>
    core.parsePortableReport({
      ...portable,
      budget: {
        ...portable.budget,
        totals: { utf8Bytes: 99, utf16CodeUnits: 3, estimatedTokens: 1 },
      },
    }),
  ).toThrow()
})
