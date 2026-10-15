import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as core from '../../index.js'
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
function api(name: string): (...args: unknown[]) => unknown {
  const fn: unknown = Reflect.get(core, name)
  expect(fn).toBeTypeOf('function')
  return fn as (...args: unknown[]) => unknown
}
function report() {
  const root = mkdtempSync(join(tmpdir(), 'ctx-report-')); dirs.push(root)
  writeFileSync(join(root, 'CLAUDE.md'), 'fixture')
  return api('buildAgentDoctorReport')({ root, home: root, hosts: ['claude'], scopes: ['project'] }) as Record<string, unknown>
}
it('exposes a reusable legacy report and rejects inconsistent counts and versions', () => {
  const r = report()
  const parse = api('parseAgentDoctorReport')
  expect(parse(r)).toEqual(r)
  expect(() => parse({ ...r, schemaVersion: 2 })).toThrow()
  expect(() => parse({ ...r, summary: { pass: 0, warn: 0, fail: 0, unknown: 0, notApplicable: 0, mandatoryFailures: 0 } })).toThrow()
  expect(() => parse({ ...r, findings: [{ code: 'x', status: 'unknown', message: 'x', source: 'runtime', mandatory: false }] })).toThrow()
})
it('bounds every portable string and excludes arbitrary local/runtime strings', () => {
  const r = report()
  const sentinel = 'HOSTILE /Users/private/token=synthetic-secret '
  r.root = sentinel
  r.runtimeEvidence = { path: sentinel, kind: 'declared-signature', signature: { algorithm: sentinel, keyId: sentinel } }
  r.findings = [{ code: sentinel, status: 'pass', message: sentinel, path: sentinel, server: sentinel, capability: sentinel, expected: sentinel, observed: sentinel, source: 'runtime', mandatory: false }]
  r.summary = { pass: 1, warn: 0, fail: 0, unknown: 0, notApplicable: 0, mandatoryFailures: 0 }
  const projected = api('projectPortableReport')(r)
  expect(JSON.stringify(projected)).not.toContain('HOSTILE')
  expect(JSON.stringify(projected)).not.toContain('private')
  expect(api('parsePortableReport')(projected)).toEqual(projected)
  expect(() => api('parsePortableReport')({ ...(projected as object), schemaVersion: 999 })).toThrow()
  const findings = (projected as {findings: Record<string,unknown>[]}).findings
  expect(findings[0]).toMatchObject({ code: 'unrecognized-finding', source: 'runtime', mandatory: false })
  for (const [key, value] of Object.entries(findings[0] ?? {})) {
    if (typeof value === 'string') expect(() => api('parsePortableReport')({ ...(projected as object), findings: [{ ...findings[0], [key]: sentinel }] })).toThrow()
  }
})
it('rejects hostile portable envelope strings and inconsistent counts', () => {
  const p = api('projectPortableReport')(report()) as {findings: unknown[]; selection: object}
  const parse = api('parsePortableReport')
  for (const key of ['kind', 'profileVersion', 'runtimeEvidence']) expect(() => parse({ ...p, [key]: 'hostile' })).toThrow()
  expect(() => parse({ ...p, selection: { hosts: ['hostile'], scopes: ['project'] } })).toThrow()
  expect(() => parse({ ...p, findings: [...p.findings, ...p.findings] })).toThrow()
})
it('ships importable valid, invalid and unsupported contract fixtures', async () => {
  const { readFileSync } = await import('node:fs')
  const parse = api('parsePortableReport')
  const fixture = (name: string) => JSON.parse(readFileSync(new URL('../../../../../docs/contracts/' + name, import.meta.url), 'utf8')) as unknown
  expect(parse(fixture('portable-v1.valid.json'))).toHaveProperty('schemaVersion', 1)
  expect(() => parse(fixture('portable-v1.invalid.json'))).toThrow()
  expect(() => parse(fixture('portable.unsupported.json'))).toThrow()
})
