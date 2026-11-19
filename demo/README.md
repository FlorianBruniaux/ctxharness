# Backend profile demo

Interactive example of the v0.6.0 `checkConfigExpectations` engine. The backend expectation requires the named `design` MCP server to be absent from `.mcp.json`.

The POST endpoint accepts only the three fixed fixture names. It writes a fixture into a fresh temporary directory, runs the released core, returns evidence with project-relative paths, and removes the directory. It never accepts repository paths or executes MCP commands. The browser renders results as text.

## Verify

```sh
cd demo
npm ci --ignore-scripts
npm test
```

## Deploy

Deploy this directory as a Vercel project using Node.js 22, the Other framework preset, and the provided `vercel.json`. The static frontend and `/api/check` Node function share the same fixtures. The production deployment must be publicly accessible for the README demo link.

The dependency is pinned to the core archive from the v0.6.0 GitHub release. No LLM, API key, repository upload or external MCP connection is involved. The demo illustrates project declarations, not effective loading, permissions or runtime behavior.

## Navigation and themes

The static page has six chapter anchors, a mobile menu and a grouped footer. Light is the default. The theme menu offers Light, Dark and System, with a choice stored under `ctxharness.theme`. Storage failure leaves switching available for the current page. With JavaScript disabled, the chapter links stay visible and the default light theme remains usable.

`public/shell.js` owns theme and navigation behavior; `public/app.js` owns the checking demo. The existing API and fixtures are unchanged by the visual revision. The [diagram sources and acceptance record](../docs/assets/infographics/README.md) cover the Gemini assets. The HTML explanations remain available on mobile.

Use an existing Playwright module and the system Chrome to run the browser checks. Do not install a browser:

```sh
BASE=http://127.0.0.1:PORT OUT=/absolute/proof-directory \
PLAYWRIGHT_MODULE=/existing/path/to/playwright \
node tools/shell-check.cjs
```

`tools/visual-check.cjs` additionally checks layout, all three demo verdicts, contrast, focus, reduced motion, clipboard and download behavior at 1440 px light/dark and 390 px light. Its output directory needs `original-dom.json` from the preserved pre-change DOM. These local checks do not establish deployment or a published npm version.

The [CI evidence copy review](docs/ci-evidence-review.md) records the anonymized case update, example verification, rendered checks and remaining evidence limits.

## SEO build

`npm run build` generates `dist` from the HTML source and `lib/site.js`. Development and preview output stays crawlable with `noindex` and no sitemap. Production output adds the single canonical sitemap URL. The default canonical origin is `https://ctxharness.bruniaux.com/`, whose DNS and HTTPS were verified on 2026-11-19. Set `SITE_URL` only after verifying any future replacement domain.

See [landing SEO and publication checks](../docs/seo.md) for source ownership, production builds, custom-domain switching and Google evidence limits. The API, runtime demo scripts and fixtures are unchanged by this build.
