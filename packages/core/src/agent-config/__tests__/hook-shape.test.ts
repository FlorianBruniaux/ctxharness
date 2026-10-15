import { afterEach, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inventoryAgentConfig } from '../inventory.js'
import { scanHooks } from '../scanners/hooks.js'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
function scan(hooks: unknown, host: 'claude' | 'codex' = 'claude') {
  const root = mkdtempSync(join(tmpdir(), 'ctx-hook-shape-')); dirs.push(root)
  const dir = join(root, '.' + host); mkdirSync(dir)
  writeFileSync(join(dir, host === 'claude' ? 'settings.json' : 'hooks.json'), JSON.stringify({ hooks }))
  return scanHooks(inventoryAgentConfig({ root, home: root, hosts: [host], scopes: ['project'] }))
}
it.each([null, 'bad', [], { PreToolUse: 'bad' }, { PreToolUse: [null] }, { PreToolUse: [{ hooks: 'bad' }] }, { PreToolUse: [{}] }, { PreToolUse: [{ hooks: [{}] }] }, { PreToolUse: [{ matcher: 3, hooks: [] }] }])('rejects malformed container/group/handler %j', (hooks) => {
  expect(scan(hooks)).toContainEqual(expect.objectContaining({ code: 'hook-config-invalid', status: 'fail' }))
})
it.each(['claude', 'codex'] as const)('validates command/args types for %s', (host) => {
  for (const handler of [{ type: 'command', command: 'echo', args: 'bad' }, { type: 'command', command: 'echo', args: [42] }, { type: 'command', command: 42 }]) {
    expect(scan({ PreToolUse: [{ hooks: [handler] }] }, host).some(f => f.status === 'fail')).toBe(true)
  }
})
it.each([{ type: 'http' }, { type: 'http', url: 42 }, { type: 'mcp_tool', server: 's' }, { type: 'mcp_tool', server: 42, tool: 't' }, { type: 'prompt', prompt: '' }, { type: 'agent', prompt: [] }])('checks required supported handler fields %j', (handler) => {
  expect(scan({ PreToolUse: [{ hooks: [handler] }] })).toContainEqual(expect.objectContaining({ code: 'hook-config-invalid', status: 'fail' }))
})
it('distinguishes omitted, empty and unsupported declarations', () => {
  expect(scan(undefined)).toEqual([])
  expect(scan({})).toContainEqual(expect.objectContaining({ code: 'hook-config-empty', status: 'pass' }))
  const unsupported = scan({ PreToolUse: [{ hooks: [{ type: 'future' }] }] })
  expect(unsupported).toContainEqual(expect.objectContaining({ code: 'hook-handler-unsupported', status: 'warn' }))
  expect(unsupported.some(f => f.status === 'fail')).toBe(false)
})
it('never executes a synthetic command while validating a malformed sibling', () => {
  const sentinel = join(tmpdir(), 'ctx-never-execute-' + process.pid)
  expect(existsSync(sentinel)).toBe(false)
  const findings = scan({ PreToolUse: [{ hooks: [{ type: 'command', command: 'touch ' + sentinel }, {}] }] })
  expect(findings.some(f => f.status === 'fail')).toBe(true)
  expect(existsSync(sentinel)).toBe(false)
})
