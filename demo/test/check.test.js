import assert from 'node:assert/strict'
import { test } from 'node:test'
import handler from '../api/check.js'

async function request(body, method = 'POST') {
  const response = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
  await handler({ method, body }, response)
  return response
}

test('accepts a backend configuration without the design MCP', async () => {
  const result = await request({ scenario: 'clean' })
  assert.equal(result.statusCode, 200)
  assert.equal(result.body.status, 'pass')
  assert.equal(result.body.findings[0].observed, 'absent')
  assert.equal(result.body.version, '0.6.0')
})

test('fails when the forbidden design MCP is declared', async () => {
  const result = await request({ scenario: 'design' })
  assert.equal(result.statusCode, 200)
  assert.equal(result.body.status, 'fail')
  assert.equal(result.body.findings[0].observed, 'present')
  assert.equal(result.body.findings[0].code, 'config-expectation-mismatch')
})

test('keeps invalid JSON unknown and fails the aggregate check', async () => {
  const result = await request({ scenario: 'invalid' })
  assert.equal(result.statusCode, 200)
  assert.equal(result.body.status, 'fail')
  assert.equal(result.body.findings[0].status, 'unknown')
  assert.equal(result.body.findings[0].observed, 'unresolved')
})

test('returns deterministic evidence without temporary server paths', async () => {
  const first = await request({ scenario: 'design' })
  const second = await request({ scenario: 'design' })
  assert.equal(first.statusCode, 200)
  assert.deepEqual(first.body, second.body)
  assert.equal(first.body.findings[0].path, '.mcp.json')
  assert.ok(!JSON.stringify(first.body).includes('ctxharness-demo-'))
})

test('rejects arbitrary inputs instead of treating them as files or commands', async () => {
  for (const body of [
    null,
    {},
    { scenario: '../../etc/passwd' },
    { scenario: 'clean', root: '/' },
  ]) {
    const result = await request(body)
    assert.equal(result.statusCode, 400)
  }
})

test('rejects methods other than POST', async () => {
  const result = await request({ scenario: 'clean' }, 'GET')
  assert.equal(result.statusCode, 405)
  assert.equal(result.headers.Allow, 'POST')
})
