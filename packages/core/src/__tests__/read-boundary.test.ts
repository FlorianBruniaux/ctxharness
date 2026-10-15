import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, linkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runScanner } from '../scanners/index.js'
import { scanFile } from '../scan.js'
import { run } from '../runner.js'
import { spawnSync } from 'node:child_process'
import { readContext } from '../fs-boundary.js'

const dirs: string[] = []
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'ctx-boundary-'))
  dirs.push(base)
  const root = join(base, 'project')
  mkdirSync(root)
  return { base, root, doc: join(root, 'CLAUDE.md'), outside: join(base, 'outside.md') }
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('caller-owned import boundaries', () => {
  it('rejects a named pipe without waiting for a writer', () => {
    const f = fixture()
    expect(spawnSync('mkfifo', [f.doc]).status).toBe(0)
    const module = new URL('../fs-boundary.ts', import.meta.url).href
    const script =
      'import {readContext} from ' +
      JSON.stringify(module) +
      ';console.log(JSON.stringify(readContext([process.argv[1]],{allowedRoots:[process.argv[2]]})))'
    const child = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', script, f.doc, f.root],
      { timeout: 1500, encoding: 'utf8' },
    )
    expect(child.error).toBeUndefined()
    expect(child.status).toBe(0)
    expect(JSON.parse(child.stdout)).toMatchObject({
      complete: false,
      files: [],
      edges: [{ status: 'unavailable' }],
    })
  })

  it('discovers descendants reachable within the depth cap regardless of reference order', () => {
    const f = fixture()
    writeFileSync(f.doc, '@a.md @b.md')
    writeFileSync(join(f.root, 'a.md'), '@b.md')
    writeFileSync(join(f.root, 'b.md'), '@leaf.md')
    writeFileSync(join(f.root, 'leaf.md'), 'leaf')
    const result = readContext([f.doc], { allowedRoots: [f.root], maxDepth: 3 })
    expect(result.files.some((file) => file.path.endsWith('/leaf.md'))).toBe(true)
    expect(result.files).toHaveLength(4)
    expect(result.complete).toBe(true)
  })

  it('resolves relative imports from every hardlink location while measuring content once', () => {
    const f = fixture()
    mkdirSync(join(f.root, 'a'))
    mkdirSync(join(f.root, 'b'))
    writeFileSync(join(f.root, 'a/root.md'), '@child.md')
    linkSync(join(f.root, 'a/root.md'), join(f.root, 'b/root.md'))
    writeFileSync(join(f.root, 'a/child.md'), 'first child')
    writeFileSync(join(f.root, 'b/child.md'), 'second child')
    const result = readContext([join(f.root, 'a/root.md'), join(f.root, 'b/root.md')], {
      allowedRoots: [f.root],
      maxDepth: 3,
    })
    expect(result.files.map((file) => file.content).sort()).toEqual([
      '@child.md',
      'first child',
      'second child',
    ])
    expect(result.edges.filter((edge) => edge.status === 'duplicate')).toHaveLength(1)
    expect(result.complete).toBe(true)
  })

  it.each(['@../outside.md', 'absolute', 'symlink'])(
    'rejects %s before measuring its content',
    (reference) => {
      const f = fixture()
      writeFileSync(f.outside, 'x'.repeat(400))
      if (reference === 'symlink') symlinkSync(f.outside, join(f.root, 'link.md'))
      writeFileSync(
        f.doc,
        reference === 'absolute'
          ? `@${f.outside}`
          : reference === 'symlink'
            ? '@link.md'
            : reference,
      )
      const first = runScanner('contextBudget', f.doc, '', {
        followImports: true,
        allowedRoots: [f.base],
      })
      writeFileSync(f.outside, 'x'.repeat(800))
      const second = runScanner('contextBudget', f.doc, '', {
        followImports: true,
        allowedRoots: [f.base],
      })
      expect(second[0]?.actual).toBe(first[0]?.actual)
      expect(second[0]?.status).toBe('warn')
      expect(second[0]?.note).toContain('outside-boundary')
    },
  )

  it('does not verify claims from outside scanFile root', () => {
    const f = fixture()
    writeFileSync(f.doc, '@../outside.md')
    writeFileSync(f.outside, 'Use `missing.ts`')
    expect(scanFile(f.doc, f.root)).toEqual([])
  })

  it('deduplicates realpaths and hardlinks, retains cycle termination', () => {
    const f = fixture()
    writeFileSync(join(f.root, 'inner.md'), '@CLAUDE.md\nhello')
    symlinkSync(join(f.root, 'inner.md'), join(f.root, 'alias.md'))
    linkSync(join(f.root, 'inner.md'), join(f.root, 'hard.md'))
    writeFileSync(f.doc, '@inner.md @alias.md @hard.md')
    const result = runScanner('contextBudget', f.doc, '', { followImports: true })
    expect(result[0]?.actual).toBe('11 tokens (incl. imports)')
    expect(result[0]?.status).toBe('pass')
  })

  it('marks depth, unsupported references, missing sources and byte caps incomplete', () => {
    const f = fixture()
    writeFileSync(f.doc, '@https://example.test/x.md @missing.md @two.md')
    writeFileSync(join(f.root, 'two.md'), '@three.md')
    writeFileSync(join(f.root, 'three.md'), '@four.md')
    writeFileSync(join(f.root, 'four.md'), 'not counted')
    const result = runScanner('contextBudget', f.doc, '', { followImports: true })
    expect(result[0]?.status).toBe('warn')
    expect(result[0]?.note).toContain('unsupported-reference')
    expect(result[0]?.note).toContain('unavailable')
    expect(result[0]?.note).toContain('depth-limit')
    writeFileSync(f.doc, 'x'.repeat(4 * 1024 * 1024 + 1))
    expect(runScanner('contextBudget', f.doc, '', { followImports: true })[0]?.note).toContain(
      'byte-limit',
    )
  })

  it('passes runner-owned roots separately from scannerArgs', async () => {
    const f = fixture()
    mkdirSync(join(f.root, 'docs'))
    writeFileSync(f.doc, 'hello')
    writeFileSync(join(f.root, 'docs', 'nested.md'), '@../CLAUDE.md @../../outside.md')
    writeFileSync(f.outside, 'x'.repeat(1000))
    const result = await run(
      {
        version: 1,
        files: { include: ['docs/*.md'], exclude: [] },
        assertions: [
          {
            id: 'scope',
            extractor: 'constant',
            extractorArgs: { value: '' },
            scanner: 'contextBudget',
            scannerArgs: { followImports: true, allowedRoots: [f.base] },
          },
        ],
      },
      f.root,
    )
    expect(result.assertions[0]?.results[0]?.actual).toBe('9 tokens (incl. imports)')
    expect(result.assertions[0]?.results[0]?.note).toContain('outside-boundary')
  })
})

it('surfaces missing sources and caller-owned caps through scanFile coverage', async () => {
  const { scanFileWithCoverage } = await import('../scan.js')
  const f = fixture()
  writeFileSync(f.doc, '@gone.md @inner.md')
  writeFileSync(join(f.root, 'inner.md'), 'hello')
  const scanned = scanFileWithCoverage(f.doc, f.root, { allowedRoots: [f.root], maxFiles: 1 })
  expect(scanned.coverage.complete).toBe(false)
  expect(scanned.coverage.edges.map((e) => e.status)).toEqual([
    'included',
    'unavailable',
    'file-limit',
  ])
})
