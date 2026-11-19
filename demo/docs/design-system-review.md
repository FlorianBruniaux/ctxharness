# Personal design system migration

Historical review of the first, visual-only revision. The subsequent narrative revision is documented in [product-story.md](product-story.md). Its authorized body-copy changes supersede the text-preservation constraint for that later revision.

Visual scope only. Existing text, links, anchors, identifiers, ARIA, frontend logic, API, fixture data and SEO metadata are preserved. Chapter markers are the explicitly requested visual addition. No commit, push or production redeployment is included in this review.

## Original inventory

References use the saved pre-migration line numbers in `public/style.css` and `public/index.html`. The before sources and screenshots live outside Git in the chat's artifact directory.

| Deviation | Original location | Replacement |
| --- | --- | --- |
| Remote Google Fonts import | `public/style.css:1` | Local licensed Barlow Condensed and IBM Plex |
| Non-brand base colors, five private aliases | `public/style.css:4`, `:5`, `:6`, `:7`, `:8` | Shared semantic tokens |
| DM Sans body and controls | `public/style.css:19`, `:149` | IBM Plex Sans |
| Literal focus orange | `public/style.css:36` | `--accent` |
| 1200px shell with 40px / 20px gutters | `public/style.css:42`, `:44`, `:45`, `:382`, `:383` | 75rem shell, 1rem gutters |
| No full-width bands or chapter markers | `public/index.html:27`, `:37`, `:103`, `:126` | Ink hero, base demo, accent CTA, paper overview; three ChapterLabel adapters |
| Wrong display family, tracking and weights | `public/style.css:93`, `:117`, `:183`, `:243`, `:289` | Barlow Condensed 700 |
| Literal panel colors | `public/style.css:134`, `:153`, `:159`, `:166`, `:178`, `:204`, `:208`, `:272` | Surface, border and text tokens |
| Tabs with custom selection surfaces and no shared active-state treatment | `public/style.css:137`, `:152` | Inverted text / background tokens, 44px targets |
| Blurred selected-tab shadow | `public/style.css:156` | Inverted text/surface selection, no movement |
| Arbitrary green / orange / amber result colors | `public/style.css:223`, `:224`, `:230`, `:231`, `:234`, `:235`, `:250`, `:255` | Semantic status tokens with text verdicts retained |
| Custom undersized rerun, download and copy buttons | `public/index.html:86`, `:111`, `:116`; `public/style.css:252`, `:298`, `:323` | Shared secondary, primary and secondary families, minimum 44px |
| Literal terminal colors | `public/style.css:308`, `:309`, `:316`, `:324`, `:325`, `:326`, `:338` | Scoped ink-band tokens |
| Local radii, though all below 12px | `public/style.css:135`, `:141`, `:226`, `:256`, `:310`, `:327` | 6px control and 8px card tokens |
| No dark theme or reduced-motion rule | `public/style.css:3` | System color preference, explicit data-theme override, reduced-motion CSS |

Literal CSS color occurrences before migration: **30**. Blurred shadows: **1**. DM Sans declarations: **2**. Large radii, negative translateY, transition-all and banned accent literals: **0** each. The guard is written before migration with all forbidden-pattern budgets at zero, so the existing deviations must fail before the visual changes make it pass. The unchanged `theme-color` meta is outside the CSS color guard, as required by the SEO preservation constraint.

## Reference decisions

The Guide contract wins where historical sources differ. Dark links use the Guide's `#ffb17a`; action fill uses `--action: #f97316`. Broad skill tokens containing unused blue accents and soft shadows are omitted from this adapter. The static HTML stack is retained; ChapterLabel is adapted as plain markup and the original brick geometry, without adding Astro or client JavaScript. Dark mode follows the system preference because there is no existing theme control and scripts must remain unchanged.


## Final local verification

Tested with the system Google Chrome, without downloading a browser. Raw measurements are in `verification.json` in the artifact directory.

| View | Horizontal overflow | Logo / h1 offset | Minimum text contrast | Interactive targets |
| --- | --- | --- | --- | --- |
| 1440px light | 0px | 0px | 5.29:1 | 12, all at least 44px |
| 1440px dark | 0px | 0px | 5.61:1 | 12, all at least 44px |
| 390px light | 0px | 0px | 5.29:1 | 12, all at least 44px |

All three scenarios were checked in every view, including text contrast after PASS, UNKNOWN and FAIL. Every adjacent main section has a distinct surface. There are three chapter labels and one orange band. All four bundled font faces load.

Keyboard navigation reaches the rerun button, with a visible 2px focus outline. Hover preserves control/card dimensions without transforms. Reduced-motion media preference eliminates transitions and animations. Clipboard contents match the existing command, and the downloaded JSON still requires absence of the design MCP.

The initial render test caught inherited dark text on the terminal and was rerun after the scoped text token fix. Independent review caught a mobile result row that compressed the explanation. The corrected row uses a two-column grid and places the rerun action below the explanation. Inverted tab colors now change immediately, avoiding low-contrast intermediate animation frames.

The before/after browser comparison confirms identical existing text, links, IDs, ARIA, data attributes and document head. The only extra text belongs to the three explicitly requested chapter markers. Frontend JavaScript, API, fixtures, package manifests, dependency lock and Vercel configuration retain the saved SHA-256 hashes.

Independent rendered verdict from `boldguy-design-critic`: **VALIDATED**, no remaining visual blocker. The critic checked rendered desktop dark/mobile light views and all three accessible verdicts independently. No JavaScript runtime error was observed.

## Evidence and limitations

Artifacts are under `local session proof directory (not distributed)`.

- Before/after full-page PNGs, `before-1440-light.png`, `before-1440-dark.png`, `before-390-light.png`, and corresponding `after-*` files.
- Keyboard-focus screenshots, `focus-1440-light.png`, `focus-1440-dark.png`, `focus-390-light.png`.
- `before/manifest.json` and original sources, `original-dom.json`, `verification.json`.
- Additional independent critic captures are retained in `local critic proof directory (not distributed)`.

Not verified in this visual scope: Safari, Firefox, physical mobile devices, screen reader, 200% zoom, mobile dark, production rendering, npm publication and the public registry npx command. The local server has no favicon, and Chrome's automatic `/favicon.ico` request returns 404. The document head and SEO metadata are deliberately preserved. Computed text contrast was measured; this is not a complete WCAG conformance audit.

No commit, push, README link change or production deployment has been performed for this migration. The public demo continues to serve its previous appearance until an authorized deployment.
