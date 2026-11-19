import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkConfigExpectations } from '@florianbruniaux/ctxharness-core'
import { contract, scenarios, version } from '../lib/fixtures.js'

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Use POST.' })
  }
  const body = request.body
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    typeof body.scenario !== 'string' ||
    !Object.hasOwn(scenarios, body.scenario)
  )
    return response.status(400).json({ error: 'Choose a demo scenario.' })

  let root
  try {
    root = mkdtempSync(join(tmpdir(), 'ctxharness-demo-'))
    writeFileSync(join(root, '.mcp.json'), scenarios[body.scenario].content)
    const findings = checkConfigExpectations({ root, expectations: contract }).map(
      ({ path, ...finding }) => ({ ...finding, ...(path ? { path: '.mcp.json' } : {}) }),
    )
    return response.status(200).json({
      version,
      status: findings.every((finding) => finding.status === 'pass') ? 'pass' : 'fail',
      findings,
    })
  } catch {
    return response.status(500).json({ error: 'The check could not complete. Try again.' })
  } finally {
    if (root) rmSync(root, { recursive: true, force: true })
  }
}
