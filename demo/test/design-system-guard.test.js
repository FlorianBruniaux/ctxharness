import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

// Ratchets follow the Guide landing's design-system-guard.test.ts.
// A budget can only decrease. Original inventory: 30 literal colors outside
// tokens, 1 blurred shadow, 2 DM Sans declarations, no lift/all/large radius.
const publicRoot = new URL('../public/', import.meta.url)
function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    if (entry.isDirectory()) return collect(url)
    return /\.(css|html)$/.test(entry.name) ? [url] : []
  })
}
const files = collect(publicRoot).map((url) => ({
  path: fileURLToPath(url),
  source: readFileSync(url, 'utf8'),
}))

const ratchets = [
  { name: 'negative translateY', pattern: /translateY\(\s*-/gi, max: 0 },
  { name: 'transition all', pattern: /transition\s*:\s*all\b/gi, max: 0 },
  {
    name: 'soft shadow token',
    pattern: /var\(--shadow-(?:sm|md|lg|card-hover|header)\)/gi,
    max: 0,
  },
  { name: 'legacy accent', pattern: /#(?:6366f1|8b5cf6|06b6d4|3b82f6)\b/gi, max: 0 },
  { name: 'external font request', pattern: /@import\s+url\(['"]https?:/gi, max: 0 },
  { name: 'DM Sans', pattern: /DM Sans/g, max: 0 },
  {
    name: 'literal color outside tokens',
    pattern: /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\([^)]*\)/gi,
    max: 0,
    only: (path) => path.endsWith('.css') && !path.endsWith('/tokens.css'),
  },
  {
    name: 'large radius',
    pattern: /border-radius\s*:[^;}]+/gi,
    max: 0,
    forbidden: (value) =>
      [...value.matchAll(/([\d.]+)(px|rem|em)\b/g)].some(
        ([, number, unit]) => Number(number) * (unit === 'px' ? 1 : 16) >= 12,
      ),
  },
  {
    name: 'blurred shadow',
    pattern: /box-shadow\s*:[^;}]+/gi,
    max: 0,
    forbidden: (value) =>
      value
        .replace(/var\([^)]*\)/g, '')
        .split(',')
        .some((shadow) => {
          const lengths = [
            ...shadow.replace(/#[\da-f]+\b/gi, '').matchAll(/(-?[\d.]+)(?:px|rem|em)?/g),
          ]
          return lengths.length >= 3 && Number(lengths[2][1]) !== 0
        }),
  },
]

for (const { name, pattern, max, only, forbidden } of ratchets) {
  test(`design system ratchet: ${name} <= ${max}`, () => {
    const found = files
      .filter(({ path }) => !only || only(path))
      .flatMap(({ path, source }) =>
        [...source.matchAll(pattern)]
          .filter((match) => !forbidden || forbidden(match[0]))
          .map(
            (match) => `${path}:${source.slice(0, match.index).split('\n').length}: ${match[0]}`,
          ),
      )
    assert.ok(found.length <= max, `${found.length} > ${max}\n${found.join('\n')}`)
  })
}

test('button family is defined only by the shared components stylesheet', () => {
  const found = files
    .filter(({ path }) => path.endsWith('.css') && !path.endsWith('/components.css'))
    .filter(({ source }) => /\.btn(?:-primary|-secondary|-quiet)?\b[^{}]*\{/g.test(source))
  assert.deepEqual(
    found.map(({ path }) => path),
    [],
  )
})
