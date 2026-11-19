import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { buildSite } from '../scripts/build.mjs'

const canonical = 'https://ctx.example.org/'
const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url))

async function temporaryOutput(t) {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'ctxharness-seo-test-'))
  t.after(() => rm(outputDirectory, { recursive: true, force: true }))
  return outputDirectory
}

function attributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map(([, name, , value]) => [
      name.toLowerCase(),
      value,
    ]),
  )
}

function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map(([tag]) =>
    attributes(tag),
  )
}

function metadata(html, key) {
  const matches = tags(html, 'meta').filter(
    (tag) => tag.name === key || tag.property === key,
  )
  assert.equal(matches.length, 1, `Exactly one ${key} value is generated`)
  return matches[0].content
}

function canonicalLink(html) {
  const matches = tags(html, 'link').filter((tag) => tag.rel === 'canonical')
  assert.equal(matches.length, 1, 'Exactly one canonical link is generated')
  return matches[0].href
}

function structuredGraph(html) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs]) => attributes(attrs).type === 'application/ld+json')
    .map(([, , source]) => JSON.parse(source))
  assert.equal(scripts.length, 1, 'One coherent JSON-LD graph is generated')
  assert.equal(scripts[0]['@context'], 'https://schema.org')
  assert.ok(Array.isArray(scripts[0]['@graph']))
  return scripts[0]['@graph']
}

function inspectProperties(value, visit) {
  if (Array.isArray(value)) {
    value.forEach((item) => inspectProperties(item, visit))
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      visit(key, item)
      inspectProperties(item, visit)
    }
  }
}

test('production build aligns metadata, structured entities and the only sitemap URL', async (t) => {
  const outputDirectory = await temporaryOutput(t)
  await buildSite({ outputDirectory, siteUrl: canonical, environment: 'production' })
  const html = await readFile(join(outputDirectory, 'index.html'), 'utf8')
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]
  assert.ok(title?.includes('CTX Harness'))
  assert.match(title, /instructions|configuration/i)
  assert.match(metadata(html, 'description'), /CLAUDE\.md/)
  assert.match(metadata(html, 'description'), /AGENTS\.md/)
  assert.match(metadata(html, 'description'), /without an LLM|no LLM/i)
  assert.equal(canonicalLink(html), canonical)
  assert.equal(metadata(html, 'og:url'), canonical)
  assert.equal(metadata(html, 'og:title'), title)
  assert.equal(metadata(html, 'og:description'), metadata(html, 'description'))
  assert.equal(metadata(html, 'twitter:card'), 'summary_large_image')
  assert.ok(!metadata(html, 'robots').split(/\s*,\s*/).includes('noindex'))

  const graph = structuredGraph(html)
  assert.equal(graph.length, 4)
  const entities = new Map(graph.map((entity) => [entity['@type'], entity]))
  assert.deepEqual(
    [...entities.keys()].sort(),
    ['Person', 'SoftwareApplication', 'WebPage', 'WebSite'].sort(),
  )
  const ids = new Set(graph.map((entity) => entity['@id']))
  assert.equal(ids.size, graph.length, 'Entity identifiers are unique')
  for (const type of ['WebSite', 'WebPage', 'SoftwareApplication']) {
    assert.equal(entities.get(type).url, canonical)
  }
  assert.equal(entities.get('Person').name, 'Florian Bruniaux')
  assert.equal(entities.get('SoftwareApplication').softwareVersion, '0.6.0')
  assert.equal(entities.get('SoftwareApplication').runtimePlatform, 'Node.js')
  inspectProperties(graph, (key, value) => {
    assert.ok(!['offers', 'price', 'aggregateRating', 'review', 'reviews'].includes(key))
    assert.notEqual(value, 'FAQPage')
    if (key === '@id') assert.ok(ids.has(value), `Unresolved structured-data reference: ${value}`)
  })

  const sitemap = await readFile(join(outputDirectory, 'sitemap.xml'), 'utf8')
  assert.match(sitemap, /<urlset\b[^>]*xmlns=["']http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["']/)
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url)
  assert.deepEqual(locations, [canonical])
  assert.doesNotMatch(sitemap, /<lastmod\b/)
  const robots = await readFile(join(outputDirectory, 'robots.txt'), 'utf8')
  assert.match(robots, /^User-agent:\s*\*/m)
  assert.match(robots, /^Allow:\s*\/$/m)
  assert.deepEqual(
    [...robots.matchAll(/^Sitemap:\s*(\S+)\s*$/gm)].map(([, url]) => url),
    [new URL('sitemap.xml', canonical).href],
  )
})

for (const environment of ['preview', 'development']) {
  test(`${environment} build stays crawlable but noindex and removes a prior production sitemap`, async (t) => {
    const outputDirectory = await temporaryOutput(t)
    await buildSite({ outputDirectory, siteUrl: canonical, environment: 'production' })
    await access(join(outputDirectory, 'sitemap.xml'))
    await buildSite({ outputDirectory, siteUrl: canonical, environment })
    const html = await readFile(join(outputDirectory, 'index.html'), 'utf8')
    const directives = metadata(html, 'robots').split(/\s*,\s*/)
    assert.ok(directives.includes('noindex'))
    assert.ok(directives.includes('follow'))
    assert.equal(canonicalLink(html), canonical, 'Preview hosts are not canonical origins')
    const robots = await readFile(join(outputDirectory, 'robots.txt'), 'utf8')
    assert.match(robots, /^Allow:\s*\/$/m)
    assert.doesNotMatch(robots, /^Disallow:\s*\/$/m)
    assert.doesNotMatch(robots, /^Sitemap:/im)
    await assert.rejects(access(join(outputDirectory, 'sitemap.xml')), { code: 'ENOENT' })
  })
}

test('built assets preserve the released demo and resolve social images and fonts', async (t) => {
  const outputDirectory = await temporaryOutput(t)
  await buildSite({ outputDirectory, siteUrl: canonical, environment: 'production' })
  const html = await readFile(join(outputDirectory, 'index.html'), 'utf8')
  for (const path of [
    'app.js',
    'shell.js',
    'fonts/barlow-condensed-700.woff2',
    'fonts/ibm-plex-sans-400.woff2',
    'fonts/ibm-plex-sans-600.woff2',
    'fonts/ibm-plex-mono-400.woff2',
    'images/brand/section-hatching.svg',
    'images/infographics/static-workflow.jpg',
    'images/infographics/evidence-boundaries.jpg',
  ]) {
    assert.deepEqual(
      await readFile(join(outputDirectory, path)),
      await readFile(join(publicDirectory, path)),
      `Asset unchanged: ${path}`,
    )
  }
  assert.deepEqual(
    await readFile(join(outputDirectory, 'lib/fixtures.js')),
    await readFile(new URL('../lib/fixtures.js', import.meta.url)),
  )
  const image = new URL(metadata(html, 'og:image'))
  assert.equal(image.origin, new URL(canonical).origin)
  await access(join(outputDirectory, image.pathname))
  const icons = tags(html, 'link').filter((tag) => tag.rel === 'icon')
  assert.ok(icons.length > 0)
  for (const icon of icons) await access(join(outputDirectory, new URL(icon.href, canonical).pathname))
  const css = await readFile(join(outputDirectory, 'style.css'), 'utf8')
  assert.doesNotMatch(css, /@import\b/i)
  assert.match(css, /font-family:\s*["']Barlow Condensed["']/)
  assert.match(css, /font-family:\s*["']IBM Plex Sans["']/)
  assert.match(css, /font-display:\s*swap/)
  for (const [, path] of css.matchAll(/url\(["']?(fonts\/[^\s)"']+)["']?\)/g)) {
    await access(join(outputDirectory, path))
  }
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  assert.ok(h1)
  assert.match(h1.replace(/<[^>]*>/g, '').replace(/\s+/g, ' '), /instructions against/)
})

test('invalid canonical origins are rejected before touching the destination', async (t) => {
  const outputDirectory = await temporaryOutput(t)
  await writeFile(join(outputDirectory, 'keep.txt'), 'untouched')
  for (const siteUrl of [
    'http://ctx.example.org/',
    'https://localhost/',
    'https://localhost./',
    'https://host.local./',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://10.0.0.1/',
    'https://172.16.0.1/',
    'https://192.168.0.1/',
    'https://169.254.169.254/',
    'https://user:password@ctx.example.org/',
    'https://ctx.example.org/?v=preview',
    'https://ctx.example.org/#chapter',
    'https://ctx.example.org/nested',
  ]) {
    await assert.rejects(
      buildSite({ outputDirectory, siteUrl, environment: 'production' }),
      undefined,
      `Unsafe canonical accepted: ${siteUrl}`,
    )
    assert.deepEqual(await readdir(outputDirectory), ['keep.txt'])
    assert.equal(await readFile(join(outputDirectory, 'keep.txt'), 'utf8'), 'untouched')
  }
})
