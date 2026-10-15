import { afterEach, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inventoryAgentConfig } from '../inventory.js'
import { scanMcp } from '../scanners/mcp.js'
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function scan(args: string[], host: 'claude' | 'codex') {
  const root = mkdtempSync(join(tmpdir(), 'ctx-mcp-'))
  dirs.push(root)
  if (host === 'claude')
    writeFileSync(
      join(root, '.mcp.json'),
      JSON.stringify({ mcpServers: { fixture: { command: 'inert', args } } }),
    )
  else {
    mkdirSync(join(root, '.codex'))
    writeFileSync(
      join(root, '.codex/config.toml'),
      '[mcp_servers.fixture]\ncommand = "inert"\nargs = ' + JSON.stringify(args) + '\n',
    )
  }
  return scanMcp(inventoryAgentConfig({ root, home: root, hosts: [host], scopes: ['project'] }))
}
it.each(['claude', 'codex'] as const)('preserves numeric resource limits in %s', (host) => {
  for (const args of [
    ['--max-tokens', '1024'],
    ['--max-tokens=1024'],
    ['--token-budget', '4096'],
    ['--token-budget=4096'],
  ]) {
    expect(scan(args, host)).toContainEqual(
      expect.objectContaining({ code: 'mcp-config-valid', status: 'pass' }),
    )
  }
})
it.each(['claude', 'codex'] as const)(
  'keeps genuine credentials and near misses redacted in %s',
  (host) => {
    const sentinel = 'synthetic-private-value-987654'
    for (const args of [
      ['--api-key', sentinel],
      ['--api-key=' + sentinel],
      ['--token', sentinel],
      ['--token-budget-extra', sentinel],
      ['--token-budget', sentinel],
      ['Authorization: Bearer ' + sentinel],
      ['API_TOKEN=' + sentinel],
      ['--token', '$' + '{API_TOKEN:-' + sentinel + '}'],
    ]) {
      const findings = scan(args, host)
      expect(findings).toContainEqual(
        expect.objectContaining({ code: 'mcp-literal-secret', status: 'fail' }),
      )
      expect(JSON.stringify(findings)).not.toContain(sentinel)
    }
  },
)
it('allows environment references without masking a later literal credential', () => {
  const env = '$' + '{API_TOKEN}'
  expect(scan(['--token', env], 'claude')[0]?.status).toBe('pass')
  expect(scan(['--max-tokens=1024', '--token=literal-secret'], 'claude')[0]?.status).toBe('fail')
})
