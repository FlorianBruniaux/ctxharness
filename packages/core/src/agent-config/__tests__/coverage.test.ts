import { afterEach, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import * as core from '../../index.js'
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
function write(path: string, value: string) { mkdirSync(dirname(path), {recursive:true}); writeFileSync(path,value) }
function fixture() { const root = mkdtempSync(join(tmpdir(),'ctx-coverage-')); dirs.push(root); return realpathSync(root) }
function coverage(root: string, home: string, hosts: ('claude'|'codex')[] = ['claude','codex']) {
  const fn = Reflect.get(core,'buildConfigCoverage') as (i: unknown) => { items: {path: string; states: string[]; loaded: string}[]; support: {surface:string; status:string}[] }
  expect(fn).toBeTypeOf('function')
  return fn(core.inventoryAgentConfig({root,home,hosts,scopes:['project','global']}))
}
it('retains conditional rules without current matching files and marks shadowed Codex instructions', () => {
  const root=fixture(), home=fixture()
  write(join(root,'CLAUDE.md'),'@local.md'); write(join(root,'local.md'),'body')
  write(join(root,'AGENTS.md'),'shadowed'); write(join(root,'AGENTS.override.md'),'override')
  write(join(root,'.claude/rules/rare.md'),'---\npaths: ["rare/**/*.rs"]\n---\nKeep this useful rule')
  write(join(home,'.claude/CLAUDE.md'),'global')
  const report=coverage(root,home)
  expect(report.items).toContainEqual(expect.objectContaining({path:join(root,'.claude/rules/rare.md'),states:expect.arrayContaining(['declared','conditional'])}))
  expect(report.items).toContainEqual(expect.objectContaining({path:join(root,'AGENTS.md'),states:expect.arrayContaining(['shadowed'])}))
  expect(report.items).toContainEqual(expect.objectContaining({path:join(root,'local.md'),states:expect.arrayContaining(['discovered'])}))
  expect(report.items.every(i=>i.loaded==='unknown')).toBe(true)
  for(const surface of ['memory','output-styles','plugins','commands','managed-settings']) expect(report.support).toContainEqual(expect.objectContaining({surface,status:'unsupported'}))
})
it.each(['claude','codex'] as const)('keeps invalid and missing evidence explicit for %s', host => {
  const root=fixture(),home=fixture()
  write(join(root,host==='claude'?'.claude/settings.json':'.codex/hooks.json'),JSON.stringify({hooks:{PreToolUse:'bad'}}))
  const report=coverage(root,home,[host])
  expect(report.items.some(i=>i.states.includes('invalid'))).toBe(true)
  expect(report.items.some(i=>i.states.includes('unresolved'))).toBe(true)
})
it('retains outside-selection evidence and deduplicates repeated roots without following skill cycles', () => {
  const root=fixture(),home=fixture()
  write(join(home,'outside.md'),'outside')
  write(join(root,'CLAUDE.md'),'@' + join(home,'outside.md'))
  mkdirSync(join(root,'.claude/skills'),{recursive:true})
  symlinkSync(join(root,'.claude/skills'),join(root,'.claude/skills/cycle'))
  const inventory=core.inventoryAgentConfig({root,home,hosts:['claude','claude'],scopes:['project','project']})
  expect(new Set(inventory.roots.map(r=>r.path)).size).toBe(inventory.roots.length)
  const fn=Reflect.get(core,'buildConfigCoverage') as (i:unknown)=>{items:{states:string[]}[]}
  expect(fn).toBeTypeOf('function')
  expect(fn(inventory).items.some(i=>i.states.includes('outside-selection'))).toBe(true)
})
it('exports coverage without source paths and validates hostile enum fields',()=>{
  const root=fixture(),home=fixture();write(join(root,'CLAUDE.md'),'inert')
  const report=core.buildAgentDoctorReport({root,home,hosts:['claude'],scopes:['project'],includeCoverage:true})
  const portable=core.projectPortableReport(report)
  expect(portable.coverage?.items.length).toBeGreaterThan(0)
  expect(JSON.stringify(portable)).not.toContain(root)
  expect(()=>core.parsePortableReport({...portable,coverage:{...portable.coverage,nativeClient:'HOSTILE'}})).toThrow()
})
