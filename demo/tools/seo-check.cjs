// Existing Playwright and system Chrome only; no browser installation.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { BASE: base, OUT: out, PRODUCTION_DIR: production } = process.env
assert.ok(base && out && production, 'BASE, OUT and PRODUCTION_DIR are required')
;(async () => {
  const { site } = await import(pathToFileURL(path.resolve(__dirname, '../lib/site.js')).href)
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })
    const cssRequests = []
    page.on('request', request => { if (request.resourceType() === 'stylesheet') cssRequests.push(new URL(request.url()).pathname) })
    await page.goto(`${base}/?v=seo-contract#how-title`, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    assert.equal(await page.title(), site.title)
    const metadata = await page.evaluate(() => ({
      canonical: document.querySelector('link[rel=canonical]').href,
      og: document.querySelector('meta[property="og:url"]').content,
      robots: document.querySelector('meta[name=robots]').content,
      description: document.querySelector('meta[name=description]').content,
      graph: JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent),
      h1: document.querySelector('h1').textContent,
      fontResources: performance.getEntriesByType('resource').filter(e => e.name.endsWith('.woff2')).map(e => e.name),
    }))
    assert.equal(metadata.canonical, site.url)
    assert.equal(metadata.og, site.url)
    assert.match(metadata.robots, /noindex/)
    assert.equal(metadata.description, site.description)
    assert.equal(metadata.graph['@graph'].length, 4)
    assert.match(metadata.h1, /instructions against/)
    assert.deepEqual(cssRequests, ['/style.css'])
    assert.equal(new Set(metadata.fontResources).size, metadata.fontResources.length, 'No duplicate font transfers')
    const robots = await page.request.get(`${base}/robots.txt`)
    assert.equal(robots.status(), 200)
    assert.match(robots.headers()['content-type'], /text\/plain/)
    assert.match(await robots.text(), /Allow: \//)
    assert.doesNotMatch(await robots.text(), /Sitemap:/)
    assert.equal((await page.request.get(`${base}/sitemap.xml`)).status(), 404, 'Development has no sitemap')
    assert.equal((await page.request.get(`${base}/not-a-page`)).status(), 404, 'Unknown pages do not become soft 404s')
    const icon = await page.request.get(`${base}/favicon.svg`)
    assert.equal(icon.status(), 200)
    assert.match(icon.headers()['content-type'], /image\/svg\+xml/)
    const social = await page.request.get(`${base}${site.image}`)
    assert.equal(social.status(), 200)
    assert.match(social.headers()['content-type'], /image\/jpeg/)
    const xml = fs.readFileSync(path.join(production, 'sitemap.xml'), 'utf8')
    const parsed = await page.evaluate(text => {
      const doc = new DOMParser().parseFromString(text, 'application/xml')
      return { errors: doc.querySelectorAll('parsererror').length, namespace: doc.documentElement.namespaceURI, locations: [...doc.querySelectorAll('loc')].map(el => el.textContent), lastmod: doc.querySelectorAll('lastmod').length }
    }, xml)
    assert.deepEqual(parsed, { errors: 0, namespace: 'http://www.sitemaps.org/schemas/sitemap/0.9', locations: [site.url], lastmod: 0 })
    const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 900 } })
    const mobile = await nojs.newPage()
    await mobile.goto(base, { waitUntil: 'networkidle' })
    assert.equal(await mobile.title(), site.title)
    assert.ok(await mobile.locator('#title').isVisible())
    assert.ok(await mobile.locator('.section-nav').isVisible())
    assert.ok(await mobile.locator('noscript').isVisible())
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
    const report = { collectedAt: new Date().toISOString(), localMetadata: metadata, stylesheetRequests: cssRequests, productionXml: parsed, previewNoindex: true, assetMimeChecks: true, noJsMobile: true, publicDeploymentVerified: false, googleIndexingVerified: false }
    fs.writeFileSync(path.join(out, 'seo-browser-verification.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify({ stylesheetRequests: cssRequests.length, duplicateFontTransfers: false, productionXml: 'parsed', previewNoindex: true, noJsMobile: true }))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
