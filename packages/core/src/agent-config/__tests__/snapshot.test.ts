import { afterEach, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as core from '../../index.js'
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function api(name: string): (...args: unknown[]) => unknown {
  const fn: unknown = Reflect.get(core, name)
  expect(fn).toBeTypeOf('function')
  return fn as (...args: unknown[]) => unknown
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ctx-config-snapshot-'))
  dirs.push(root)
  writeFileSync(join(root, 'CLAUDE.md'), 'one')
  return root
}
function snapshot(root: string) {
  const report = core.buildAgentDoctorReport({
    root,
    home: root,
    hosts: ['claude'],
    scopes: ['project'],
    includeCoverage: true,
    includeBudget: true,
  })
  return api('buildConfigSnapshot')(report, { home: root }) as Record<string, unknown>
}
it('serializes a separate artifact and compares equivalent scans despite order/timestamps', () => {
  const root = fixture(),
    a = snapshot(root),
    b = snapshot(root)
  b.generatedAt = '2026-01-01T00:00:00.000Z'
  b.sources = [...(b.sources as unknown[])].reverse()
  b.findings = [...(b.findings as unknown[])].reverse()
  expect(api('parseConfigSnapshot')(JSON.parse(JSON.stringify(a)))).toEqual(a)
  expect(api('compareConfigSnapshots')(a, b)).toMatchObject({ status: 'equal', changes: [] })
  expect(JSON.stringify(a)).not.toContain(root)
})
it('reports changed content, added/untracked inventory, renames and removals structurally', () => {
  const root = fixture(),
    a = snapshot(root)
  writeFileSync(join(root, 'CLAUDE.md'), 'two')
  const b = snapshot(root)
  expect(api('compareConfigSnapshots')(a, b)).toMatchObject({ status: 'changed' })
  mkdirSync(join(root, '.claude/agents'), { recursive: true })
  writeFileSync(
    join(root, '.claude/agents/new.md'),
    '---\nname: new\ndescription: inert\n---\nbody',
  )
  const c = snapshot(root)
  expect(
    (api('compareConfigSnapshots')(b, c) as { changes: { kind: string }[] }).changes.some(
      (c) => c.kind === 'added',
    ),
  ).toBe(true)
  renameSync(join(root, '.claude/agents/new.md'), join(root, '.claude/agents/renamed.md'))
  const renamed = api('compareConfigSnapshots')(c, snapshot(root)) as {
    changes: { kind: string }[]
  }
  expect(renamed.changes.some((c) => c.kind === 'added')).toBe(true)
  expect(renamed.changes.some((c) => c.kind === 'removed')).toBe(true)
  rmSync(join(root, 'CLAUDE.md'))
  expect(api('compareConfigSnapshots')(c, snapshot(root))).toMatchObject({ status: 'changed' })
})
it('makes incomplete and incompatible selections or versions explicit', () => {
  const root = fixture()
  writeFileSync(join(root, 'CLAUDE.md'), '@missing.md')
  const a = snapshot(root)
  expect(a.complete).toBe(false)
  expect(api('compareConfigSnapshots')(a, a)).toMatchObject({
    status: 'equal',
    evidence: 'incomplete',
  })
  expect(api('compareConfigSnapshots')(a, { ...a, schemaVersion: 999 })).toMatchObject({
    status: 'incomparable',
  })
  const other = fixture()
  expect(api('compareConfigSnapshots')(a, snapshot(other))).toMatchObject({
    status: 'incomparable',
  })
  expect(() => api('parseConfigSnapshot')({ ...a, kind: 'hostile' })).toThrow()
})
it('creates snapshots explicitly and never changes files during comparison', () => {
  const root = fixture(),
    a = snapshot(root),
    path = join(root, 'baseline.json')
  api('saveConfigSnapshot')(a, path)
  const before = readFileSync(path, 'utf8')
  api('compareConfigSnapshots')(a, a)
  expect(readFileSync(path, 'utf8')).toBe(before)
  expect(() => api('saveConfigSnapshot')(a, path)).toThrow()
})
it('validates exported snapshot fixtures and rejects hostile source references', () => {
  const fixture = (name: string) =>
    JSON.parse(
      readFileSync(new URL('../../../../../docs/contracts/' + name, import.meta.url), 'utf8'),
    ) as unknown
  const valid = fixture('config-snapshot-v1.valid.json')
  expect(api('parseConfigSnapshot')(valid)).toHaveProperty('kind', 'ctxharness-config-snapshot')
  expect(() => api('parseConfigSnapshot')(fixture('config-snapshot.unsupported.json'))).toThrow()
  expect(() =>
    api('parseConfigSnapshot')({
      ...(valid as object),
      sources: [
        { ref: '/private/hostile', kind: 'content', contentDigest: null, states: ['discovered'] },
      ],
    }),
  ).toThrow()
})
