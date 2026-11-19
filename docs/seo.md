# Landing SEO and publication checks

Updated: 2026-11-19. Status: landing publication contract. Custom-domain DNS and HTTPS are verified; source publication and Google observations remain separate checks. [Documentation index](README.md).

The landing is a static HTML site with a Node build and a small Node API for the real backend expectation demo. Its source remains open on GitHub. GitHub Pages can host static files, but does not replace this API. The current hosting configuration targets Vercel. [GitHub Pages hosting model](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

## Source and generated output

- `demo/public/index.html` owns the page content, IDs and component markup. Its SEO comment is replaced at build time.
- `demo/lib/site.js` owns the public origin, title, description and social image identity.
- `demo/scripts/build.mjs` generates `demo/dist/`, including the head, combined stylesheet, fixtures, robots and optional sitemap.
- `demo/vercel.json` uses that build and publishes `dist`. The API remains in `demo/api/check.js`.

Build from the demo directory with the already installed dependencies:

```sh
npm run build
```

This defaults to development output. For an explicit local inspection of production artifacts:

```sh
VERCEL_ENV=production npm run build
```

Vercel builds use `VERCEL_ENV`. An absent environment stays non-indexable. Check the built artifact before publishing rather than assuming the deployment's name establishes its indexing policy.

## Canonical identity and a later domain change

The configured canonical origin is `https://ctxharness.bruniaux.com/`. It was attached to the existing Vercel project and its DNS, HTTPS certificate and deployed demo were verified on 2026-11-19. The audit on the previous day observed only the earlier Vercel hostname; those dated observations do not describe the current domain setup.

The default build already uses the verified custom domain. For a future migration, change the single site setting or explicitly override `SITE_URL` after verifying the destination:

```sh
SITE_URL=https://ctxharness.bruniaux.com VERCEL_ENV=production npm run build
```

The builder accepts only a root HTTPS hostname without credentials, a custom port, query or fragment. Local addresses and literal IP hosts are rejected. This is canonical-identity validation; the builder never fetches that URL.

Canonical, `og:url`, JSON-LD entity URLs and the production sitemap use the same normalized origin. Preview hostnames and review parameters such as `?v=…` do not become canonical URLs. Do not change those values independently.

A DNS CNAME alone does not attach a domain to a Vercel project. Use the project's current recommended DNS value and complete its domain verification. DNS, Vercel changes, redirects, publication and Google submissions remain separate authorized operations. [Vercel custom-domain setup](https://vercel.com/docs/domains/working-with-domains/add-a-domain).

## Production and preview outputs

| Build environment          | HTML robots                              | robots.txt                                 | sitemap.xml                                                      |
| -------------------------- | ---------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| `production`               | `index, follow, max-image-preview:large` | Crawlable, with absolute sitemap location. | One canonical root URL.                                          |
| `preview` or `development` | `noindex, follow`                        | Crawlable, without sitemap reference.      | Absent, including after a production build into the same output. |

The six chapter fragments do not create six pages. No API endpoint, asset, review parameter or fragment belongs in this sitemap. No `lastmod` is invented from the build date.

A crawler must be able to read a page's `noindex`. A blanket robots disallow does not provide the same exclusion behavior. A sitemap helps discovery and does not prove that Google indexed a URL. [Google noindex guidance](https://developers.google.com/search/docs/crawling-indexing/block-indexing), [sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

## Metadata and structured data

The generated title and description describe the CLI, TypeScript library and deterministic checks of instructions and configuration, rather than only the design MCP example. Open Graph and a large-image card use the real workflow JPEG. A local favicon follows the portfolio colors. Two critical local text fonts are preloaded, and the built stylesheet preserves the original cascade without CSS imports.

The JSON-LD graph describes `Person`, `WebSite`, `WebPage` and `SoftwareApplication`. It reuses the visible author, release fixture version and repository license. It declares no invented rating, review, price, measured benefit or npm publication status. The FAQ remains ordinary useful HTML.

Local JSON parsing and cross-reference checks do not establish Google rich-result eligibility or appearance. Search titles and snippets may also differ from supplied metadata. [Schema.org SoftwareApplication](https://schema.org/SoftwareApplication), [Google software markup requirements](https://developers.google.com/search/docs/appearance/structured-data/software-app), [title-link guidance](https://developers.google.com/search/docs/appearance/title-link).

## Verification and evidence limits

Run `npm test` from `demo`. The SEO tests build real temporary artifacts, parse their structured graph, check canonical/sitemap identity, preserve demo assets and reject invalid origin settings before output writes. The existing API and design guard checks remain part of that suite.

`demo/tools/seo-check.cjs` uses an existing Playwright module and system Chrome to inspect the generated page, no-JavaScript mobile content, asset MIME types, stylesheet requests and production sitemap XML. Do not install a browser. Its required environment variables are `BASE`, `OUT`, `PRODUCTION_DIR` and `PLAYWRIGHT_MODULE`.

Before an authorized publication, inspect the production output. After publication, independently verify public HTML, robots, sitemap, assets, unknown-route status and the live demo. If the domain changes, verify the preferred URL and old-host behavior before treating the migration as complete.

The audit did not obtain a GSC property: the existing local client declared tools but failed authentication before a Google request. Traffic, query opportunities, indexing, CrUX field metrics, cannibalization and AI Overview exposure remain unobserved. No increase in clicks, ranking, conversions or agent performance is claimed. Once access is available, select the matching property and compare compatible observed windows, with a domain migration kept visible in the comparison.
