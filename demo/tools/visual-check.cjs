// Use an existing Playwright module and the system Chrome; never download a browser.
// BASE=http://127.0.0.1:PORT OUT=/absolute/artifact/path \
// PLAYWRIGHT_MODULE=/existing/path/to/playwright node tools/visual-check.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const base = process.env.BASE
const out = process.env.OUT
assert.ok(base && out, 'BASE and OUT are required')
const reports = []

;(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  })
  try {
    for (const [theme, width] of [
      ['light', 1440],
      ['dark', 1440],
      ['light', 390],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: theme,
        permissions: ['clipboard-read', 'clipboard-write'],
      })
      await context.addInitScript((theme) => localStorage.setItem('ctxharness.theme', theme), theme)
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(base, { waitUntil: 'networkidle' })
      await page.locator('#result-title').filter({ hasText: 'FAIL' }).waitFor()
      await page.evaluate(() => document.fonts.ready)
      for (const img of await page.locator('.diagram-image').all()) {
        if (!(await img.isVisible())) continue
        await img.scrollIntoViewIfNeeded()
        await img.evaluate(el => el.decode())
        assert.equal(await img.evaluate(el => el.naturalWidth), 1376, 'Accepted infographic is decoded')
      }
      const report = { theme, width, browser: await browser.version(), errors }
      report.layout = await page.evaluate(() => {
        const h1 = document.querySelector('h1').getBoundingClientRect()
        const logo = document.querySelector('.brand').getBoundingClientRect()
        const sections = [...document.querySelectorAll('main > section')]
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          alignment: Math.abs(h1.left - logo.left),
          chapterLabels: document.querySelectorAll('.chapter-label').length,
          diagrams: document.querySelectorAll('figure').length,
          accentBands: document.querySelectorAll('main > .band-accent').length,
          surfaces: sections.map((el) => getComputedStyle(el).backgroundColor),
          primaryActions: document.querySelectorAll('.btn-primary').length,
          fonts: [
            '700 32px "Barlow Condensed"',
            '400 16px "IBM Plex Sans"',
            '600 16px "IBM Plex Sans"',
            '400 16px "IBM Plex Mono"',
          ].map((font) => ({ font, loaded: document.fonts.check(font) })),
          targets: [...document.querySelectorAll('button, a, summary')]
            .filter((el) => el.getBoundingClientRect().width > 0 && ![...document.querySelectorAll('details:not([open])')].some(d => d.contains(el) && !d.querySelector(':scope > summary')?.contains(el)))
            .map((el) => {
              const rect = el.getBoundingClientRect()
              return { text: el.textContent.trim(), width: rect.width, height: rect.height }
            }),
        }
      })
      const readContrasts = () =>
        page.evaluate(() => {
          const rgb = (value) => {
            const canvas = document.createElement('canvas')
            canvas.width = canvas.height = 1
            const ctx = canvas.getContext('2d')
            ctx.fillStyle = value
            ctx.fillRect(0, 0, 1, 1)
            return [...ctx.getImageData(0, 0, 1, 1).data].map((v, i) => (i === 3 ? v / 255 : v))
          }
          const blend = (fg, bg) =>
            fg
              .slice(0, 3)
              .map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]))
              .concat(1)
          const background = (el) => {
            const ancestors = []
            for (let node = el; node; node = node.parentElement) ancestors.unshift(node)
            return ancestors.reduce(
              (bg, node) => blend(rgb(getComputedStyle(node).backgroundColor), bg),
              [255, 255, 255, 1],
            )
          }
          const luminance = (value) =>
            value
              .slice(0, 3)
              .map((v) => {
                v /= 255
                return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
              })
              .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
          const results = []
          while (walker.nextNode()) {
            const node = walker.currentNode
            const el = node.parentElement
            if (!node.textContent.trim() || el.closest('svg,script,style,noscript')) continue
            const rect = el.getBoundingClientRect()
            if (!rect.width || !rect.height || getComputedStyle(el).visibility === 'hidden' || [...document.querySelectorAll('details:not([open])')].some(d => d.contains(el) && !d.querySelector(':scope > summary')?.contains(el)))
              continue
            const bg = background(el)
            const fg = blend(rgb(getComputedStyle(el).color), bg)
            const a = luminance(fg),
              b = luminance(bg)
            const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
            results.push({
              text: node.textContent.trim().slice(0, 100),
              ratio: +ratio.toFixed(2),
              foreground: fg,
              background: bg,
            })
          }
          return results.sort((a, b) => a.ratio - b.ratio)
        })
      report.contrasts = await readContrasts()
      report.openMenus = []
      for (const selector of ['.theme-picker', '.footer-ecosystem']) {
        await page.locator(`${selector} > summary`).click()
        const contrasts = await readContrasts()
        assert.ok(contrasts.every(item => item.ratio >= 4.5), JSON.stringify(contrasts.filter(item => item.ratio < 4.5)))
        const sizes = await page.locator(`${selector} a, ${selector} button`).evaluateAll(els => els.map(el => ({width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height})))
        assert.ok(sizes.every(item => item.width >= 44 && item.height >= 44))
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
        report.openMenus.push({selector, minimumTextContrast: contrasts[0].ratio, targets: sizes.length})
        await page.locator(`${selector} > summary`).click()
      }
      if (width < 1100) {
        await page.locator('#menu-toggle').click()
        const sizes = await page.locator('.header-navigation a').evaluateAll(els => els.map(el => ({width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height})))
        assert.ok(sizes.every(item => item.width >= 44 && item.height >= 44))
        const contrasts = await readContrasts()
        assert.ok(contrasts.every(item => item.ratio >= 4.5))
        await page.locator('#menu-toggle').focus()
        for (let index = 0; index < 6; index++) {
          await page.keyboard.press('Tab')
          const active = await page.evaluate(() => ({inSections: document.activeElement.closest('.section-nav') !== null, outline: getComputedStyle(document.activeElement).outlineWidth}))
          assert.ok(active.inSections && active.outline === '2px')
        }
        await page.keyboard.press('Escape')
        assert.equal(await page.evaluate(() => document.activeElement.id), 'menu-toggle')
        report.openMenus.push({selector: '.header-navigation', minimumTextContrast: contrasts[0].ratio, targets: sizes.length, keyboardSections: 6})
      }
      report.faq = []
      for (const details of await page.locator('.boundaries details').all()) {
        await details.locator('summary').click()
        assert.ok(await details.locator('p').isVisible())
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
          0,
        )
        const contrasts = await readContrasts()
        assert.ok(contrasts.every((item) => item.ratio >= 4.5))
        report.faq.push(await details.locator('summary').innerText())
        await details.locator('summary').click()
      }
      await page.locator('.hero-actions a[href="#demo-title"]').click()
      const demoHeading = await page.locator('#demo-title').boundingBox()
      assert.ok(
        demoHeading.y >= -1 && demoHeading.y < 900,
        `Hero demo link reaches the example: ${JSON.stringify(demoHeading)}`,
      )
      report.scenarios = []
      for (const [scenario, verdict] of [
        ['clean', 'PASS'],
        ['invalid', 'UNKNOWN'],
        ['design', 'FAIL'],
      ]) {
        await page.locator(`[data-scenario="${scenario}"]`).click()
        await page.locator('#result-title').filter({ hasText: verdict }).waitFor()
        const contrasts = await readContrasts()
        assert.ok(
          contrasts.every((item) => item.ratio >= 4.5),
          JSON.stringify(contrasts.filter((item) => item.ratio < 4.5)),
        )
        report.scenarios.push({
          scenario,
          verdict: await page.locator('#result-title').innerText(),
          overflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
          minimumTextContrast: contrasts[0].ratio,
        })
      }
      if (theme === 'light' && width === 1440) {
        const original = JSON.parse(fs.readFileSync(path.join(out, 'original-dom.json'), 'utf8'))
        const current = await page.evaluate(() => {
          const text = []
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
          while (walker.nextNode()) {
            const node = walker.currentNode
            if (node.parentElement.closest('script,style,.chapter-label')) continue
            const value = node.textContent.replace(/\s+/g, ' ').trim()
            if (value) text.push(value)
          }
          return {
            head: document.head.innerHTML,
            text,
            ids: [...document.querySelectorAll('[id]')].map((el) => el.id),
            links: [...document.querySelectorAll('a')].map((el) => ({
              href: el.getAttribute('href'),
              text: el.textContent.trim(),
            })),
            attributes: [...document.querySelectorAll('*')]
              .filter((el) => !el.closest('.chapter-label'))
              .flatMap((el) =>
                [...el.attributes]
                  .filter(
                    (a) =>
                      a.name.startsWith('aria-') ||
                      a.name.startsWith('data-') ||
                      ['role', 'tabindex'].includes(a.name),
                  )
                  .map((a) => ({ tag: el.tagName, id: el.id, name: a.name, value: a.value })),
              ),
          }
        })
        // The product-story revision intentionally changes copy and adds chapters.
        // Keep the original interaction hooks, URLs and SEO head protected.
        const normalizeHead = value => value.replace(/<script src="\/shell\.js"><\/script>/, '').replace(/>\s+</g, '><').trim()
        if (process.env.SEO_BUILD === '1') {
          // The SEO revision deliberately owns metadata. Preserve executable assets;
          // built-output SEO tests validate the new head independently.
          const scriptSources = value => [...value.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(match => match[1])
          assert.deepEqual(scriptSources(current.head), scriptSources(original.head), 'Executable scripts remain unchanged')
          assert.ok(current.head.includes('href="/style.css"'), 'The existing stylesheet entry remains')
          report.seoHeadVerifiedByBuiltOutputContract = true
        } else {
          assert.equal(normalizeHead(current.head), normalizeHead(original.head), 'SEO head remains unchanged; only theme/menu script is added')
        }
        for (const id of original.ids)
          assert.ok(current.ids.includes(id), `Missing original ID ${id}`)
        for (const link of original.links) {
          assert.ok(
            current.links.some((item) => item.href === link.href && item.text === link.text),
            `Original link changed: ${link.href}`,
          )
        }
        for (const attribute of original.attributes) {
          const count = (items) =>
            items.filter((item) => JSON.stringify(item) === JSON.stringify(attribute)).length
          assert.ok(
            count(current.attributes) >= count(original.attributes),
            `Original ARIA/data attribute changed: ${JSON.stringify(attribute)}`,
          )
        }
        report.interactionHooksAndSeoPreserved = true
        await page.locator('#copy').click()
        assert.equal(
          await page.evaluate(() => navigator.clipboard.readText()),
          await page.locator('#command').textContent(),
        )
        report.clipboard = true
        const downloadPromise = page.waitForEvent('download')
        await page.locator('#download').click()
        const download = await downloadPromise
        const file = await download.path()
        assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).expectations[0].state, 'absent')
        report.download = true
      }
      await page.waitForTimeout(180) // Let the selected control's 150ms color transition settle.
      await page.evaluate(() => scrollTo(0, 0))
      await page.screenshot({ path: path.join(out, `after-${width}-${theme}.png`), fullPage: true })
      report.hover = []
      for (const selector of ['#download', '#rerun', '#copy', '.scope .btn-quiet', '.terminal']) {
        await page.locator(selector).scrollIntoViewIfNeeded()
        const before = await page.locator(selector).boundingBox()
        await page.locator(selector).hover()
        await page.waitForTimeout(180)
        const after = await page.locator(selector).boundingBox()
        const style = await page.locator(selector).evaluate((el) => {
          const s = getComputedStyle(el)
          return {
            transform: s.transform,
            shadow: s.boxShadow,
            color: s.color,
            background: s.backgroundColor,
          }
        })
        assert.equal(style.transform, 'none')
        assert.equal(before.width, after.width)
        assert.equal(before.height, after.height)
        report.hover.push({ selector, sameSize: true, ...style })
      }
      await page.reload({ waitUntil: 'networkidle' })
      await page.locator('#result-title').filter({ hasText: 'FAIL' }).waitFor()
      report.keyboardTargets = []
      const seen = new Set()
      for (let index = 0; index < 160 && seen.size < report.layout.targets.length; index++) {
        await page.keyboard.press('Tab')
        const focused = await page.evaluate(() => {
          const el = document.activeElement
          if (!el?.matches('a,button,summary')) return null
          const style = getComputedStyle(el)
          return {
            key: el.id || el.tagName + el.textContent.trim(),
            style: style.outlineStyle,
            width: style.outlineWidth,
          }
        })
        if (!focused || seen.has(focused.key)) continue
        assert.equal(focused.style, 'solid')
        assert.equal(focused.width, '2px')
        seen.add(focused.key)
        report.keyboardTargets.push(focused)
      }
      assert.equal(
        seen.size,
        report.layout.targets.length,
        'All actions are keyboard reachable with visible focus',
      )
      let reached = false
      for (let index = 0; index < 100 && !reached; index++) {
        await page.keyboard.press('Tab')
        reached = await page.evaluate(() => document.activeElement?.id === 'rerun')
      }
      assert.ok(reached, 'Keyboard must reach rerun')
      report.focus = await page.locator('#rerun').evaluate((el) => {
        const style = getComputedStyle(el)
        return { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor }
      })
      assert.equal(report.focus.style, 'solid')
      assert.equal(report.focus.width, '2px')
      await page.screenshot({ path: path.join(out, `focus-${width}-${theme}.png`) })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      report.reducedMotion = await page
        .locator('button, .brand-interactive-card')
        .evaluateAll((els) =>
          els.map((el) => ({
            transition: getComputedStyle(el).transitionDuration,
            animation: getComputedStyle(el).animationDuration,
          })),
        )
      assert.ok(
        report.reducedMotion.every((item) => item.transition === '0s' && item.animation === '0s'),
      )
      assert.equal(report.layout.overflow, 0)
      assert.equal(report.layout.alignment, 0)
      assert.equal(report.layout.chapterLabels, 6)
      assert.equal(report.layout.diagrams, 3)
      assert.equal(report.layout.accentBands, 1)
      assert.equal(report.layout.primaryActions, 1)
      assert.ok(report.layout.fonts.every((font) => font.loaded))
      assert.ok(
        report.layout.targets.every((target) => target.height >= 44 && target.width >= 44),
        JSON.stringify(report.layout.targets),
      )
      assert.ok(
        report.layout.surfaces.every((surface, index, all) => !index || surface !== all[index - 1]),
      )
      assert.ok(
        report.contrasts.every((item) => item.ratio >= 4.5),
        JSON.stringify(report.contrasts.filter((item) => item.ratio < 4.5)),
      )
      assert.deepEqual(errors, [])
      reports.push(report)
      fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify(reports, null, 2))
      console.log(
        JSON.stringify({
          theme,
          width,
          overflow: report.layout.overflow,
          alignment: report.layout.alignment,
          minTextContrast: report.contrasts[0].ratio,
          targets: report.layout.targets.length,
          errors: errors.length,
        }),
      )
      await context.close()
    }
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
