# Navigation, themes and diagram review

Local revision, 2026-11-18. No commit, push, npm publication or deployment was performed for this revision. The public demo has not been updated by these local changes.

## What changed

The page keeps its six chapters and their existing IDs. The header now links to each chapter and collapses into a menu on narrow screens. The footer groups product entry points, project documentation, learning resources and author links, with related tools in a disclosure.

Light is the default. Light, Dark and System choices are available in the theme menu. The explicit choice persists under `ctxharness.theme`. Storage errors leave the in-memory choice usable, and System follows OS changes. Without JavaScript, section navigation remains visible and the page stays light. The hero, capabilities and footer retain their charcoal bands in both themes.

`public/shell.js` contains the new navigation and theme behavior. The checking logic in `public/app.js`, the API, fixtures and SEO metadata remain unchanged. Source hashes confirm that the local preview uses the same owned public files as the primary checkout.

The README now explains the stale-instruction problem, lists the main keywords and clarifies MCP support. CTX Harness audits MCP declarations through a CLI and TypeScript library. It does not expose an MCP endpoint. The doctor guide documents this distinction and links the explicit backend contract.

Two Gemini diagrams use the portfolio palette: a static workflow and an independent-evidence matrix. All inputs, outputs, labels and connectors were checked against the specification. The first workflow attempt was rejected for an invented font-name label. The accepted images and all attempts, prompts and provenance are under `docs/assets/infographics/`. On narrow screens, HTML cards and a definition list replace the raster diagrams.

## Verified locally

Chrome system executable was used with an already installed Playwright module. No browser was downloaded.

| View | Horizontal overflow | Logo/h1 left-edge difference | Minimum measured HTML text contrast | Closed-state actions with visible keyboard focus |
| --- | --- | --- | --- | --- |
| 1440 px light | 0 px | 0 px | 4.92:1 | 46 |
| 1440 px dark | 0 px | 0 px | 4.92:1 | 46 |
| 390 px light | 0 px | 0 px | 4.92:1 | 39 |

The browser checks also passed for:

- Theme persistence, live System changes and blocked local storage.
- Mobile menu expansion, section navigation, Escape and focus return, and desktop resize.
- All six section links reached by keyboard on mobile with a 2 px visible focus outline.
- Open theme and footer disclosures, with target sizes of at least 44 × 44 px and HTML text contrast at least 4.5:1.
- Three real demo scenarios: clean `PASS`, forbidden design declaration `FAIL`, malformed JSON `UNKNOWN` with a failed aggregate.
- Clipboard command equality and expectation-file download.
- Four local font faces loaded, reduced-motion overrides, no hover translation or size change.
- Six chapter labels, one orange band and different backgrounds for adjacent main sections.
- Existing IDs, links, ARIA/data hooks and SEO head preserved, with only the new shell script added to the head.

The six API tests and ten design-system guard tests passed. Their forbidden-pattern ceilings remain zero. Relative Markdown links and heading anchors in the six edited documentation files were checked. `git diff --check` and the shell script syntax check passed.

Before/after full-page captures, header/footer/menu panels and machine-readable browser reports are retained in the local session proof folder `ctxharness-navigation`.

## Limits

These checks do not establish a public deployment, remote CI or npm publication. They do not verify external URL availability, GitHub's Markdown image layout, a screen-reader session, other browser engines, 390 px dark mode or a full accessibility audit.

Contrast numbers cover rendered HTML text. They are not pixel-level measurements of the raster diagrams or SVG chapter labels. The diagrams were visually read and their text is provided separately, but exact Barlow/IBM font fidelity in Gemini output is not guaranteed. Provider-billed image usage is unknown; the generation record contains only an estimate.

## Independent render verdict

`boldguy-design-critic`: **VALIDATED**, no visual blocker on the examined captures. The critic confirmed readable desktop/mobile navigation, an identifiable theme choice, grouped footer links, readable diagrams and mobile HTML alternatives. It also inspected the preview and found the mobile menu and accessible tree coherent, with no overflow observed.

The critic did not independently recalculate contrast or repeat every keyboard path. Its footer-disclosure check timed out on a text selector; the implementation's browser check separately passed that interaction. No additional browser engine was checked. The only known preview console anomaly is the pre-existing local `/favicon.ico` 404.
