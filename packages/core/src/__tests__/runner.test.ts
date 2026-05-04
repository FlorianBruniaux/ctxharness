import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { loadConfig } from '../config.js'
import { run } from '../runner.js'

const FIXTURES = join(import.meta.dirname, 'fixtures')
const CONFIG_PATH = join(FIXTURES, '.ctxharness.yml')

describe('runner integration', () => {
  it('returns a RunResult with expected shape', async () => {
    const config = loadConfig(CONFIG_PATH)
    const result = await run(config, FIXTURES)

    expect(result).toHaveProperty('assertions')
    expect(result).toHaveProperty('totalPass')
    expect(result).toHaveProperty('totalFail')
    expect(result).toHaveProperty('totalError')
    expect(result).toHaveProperty('durationMs')
    expect(Array.isArray(result.assertions)).toBe(true)
  })

  it('correctly detects the next-version assertion', async () => {
    const config = loadConfig(CONFIG_PATH)
    const result = await run(config, FIXTURES)

    const nextAssertion = result.assertions.find((a) => a.id === 'next-version')
    expect(nextAssertion).toBeDefined()
    expect(nextAssertion?.expected).toBe('15.3.1')
    // CLAUDE.md says v15 (pass), AGENTS.md says v14 (fail)
    expect(nextAssertion?.status).toBe('fail')
  })

  it('correctly detects the node-version assertion as passing', async () => {
    const config = loadConfig(CONFIG_PATH)
    const result = await run(config, FIXTURES)

    const nodeAssertion = result.assertions.find((a) => a.id === 'node-version')
    expect(nodeAssertion).toBeDefined()
    expect(nodeAssertion?.expected).toBe('22.14.0')
    // Both CLAUDE.md and AGENTS.md mention Node 22 — should pass (major normalization)
    expect(nodeAssertion?.status).toBe('pass')
  })

  it('counts totalFail correctly', async () => {
    const config = loadConfig(CONFIG_PATH)
    const result = await run(config, FIXTURES)
    // next-version fails (AGENTS.md has v14), node-version passes
    expect(result.totalFail).toBeGreaterThanOrEqual(1)
  })
})
