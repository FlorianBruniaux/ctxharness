import { cp, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { site } from '../lib/site.js'
import { version } from '../lib/fixtures.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = join(root, 'public')
const marker = '<!-- ctxharness:seo -->'

function productionOrigin(value) {
  const url = new URL(value)
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    isIP(host) ||
    host.endsWith('.') ||
    !host.includes('.') ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  )
    throw new Error(
      'SITE_URL must be an HTTPS public hostname at its root, without credentials, query or fragment.',
    )
  return `${url.origin}/`
}

function inside(parent, child) {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

async function physicalPath(path) {
  try {
    return await realpath(path)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const parent = dirname(path)
    return join(await physicalPath(parent), relative(parent, path))
  }
}

const escapeAttribute = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char],
  )

function head(canonical, indexable) {
  const id = (name) => `${canonical}#${name}`
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Person',
        '@id': id('author'),
        name: 'Florian Bruniaux',
        url: 'https://www.florian.bruniaux.com/about/',
        sameAs: ['https://github.com/FlorianBruniaux'],
      },
      {
        '@type': 'WebSite',
        '@id': id('website'),
        url: canonical,
        name: site.name,
        inLanguage: 'en',
        publisher: { '@id': id('author') },
      },
      {
        '@type': 'WebPage',
        '@id': id('webpage'),
        url: canonical,
        name: site.title,
        description: site.description,
        inLanguage: 'en',
        isPartOf: { '@id': id('website') },
        mainEntity: { '@id': id('software') },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': id('software'),
        url: canonical,
        name: site.name,
        description: site.softwareDescription,
        applicationCategory: 'DeveloperApplication',
        runtimePlatform: 'Node.js',
        softwareVersion: version,
        license: `${site.repository}/blob/main/LICENSE`,
        author: { '@id': id('author') },
        sameAs: [site.repository],
      },
    ],
  }
  const meta = (name, content, key = 'name') =>
    `<meta ${key}="${name}" content="${escapeAttribute(content)}" />`
  const image = new URL(site.image, canonical).href
  return [
    `<title>${escapeAttribute(site.title)}</title>`,
    meta('description', site.description),
    meta('robots', indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow'),
    meta('author', 'Florian Bruniaux'),
    meta('theme-color', '#f3f0e9'),
    `<link rel="canonical" href="${escapeAttribute(canonical)}" />`,
    `<link rel="icon" href="/favicon.svg" type="image/svg+xml" />`,
    ...['barlow-condensed-700', 'ibm-plex-sans-400'].map(
      (font) =>
        `<link rel="preload" href="/fonts/${font}.woff2" as="font" type="font/woff2" crossorigin />`,
    ),
    meta('og:type', 'website', 'property'),
    meta('og:site_name', site.name, 'property'),
    meta('og:locale', 'en_US', 'property'),
    meta('og:url', canonical, 'property'),
    meta('og:title', site.title, 'property'),
    meta('og:description', site.description, 'property'),
    meta('og:image', image, 'property'),
    meta('og:image:type', 'image/jpeg', 'property'),
    meta('og:image:width', '1376', 'property'),
    meta('og:image:height', '768', 'property'),
    meta('og:image:alt', site.imageAlt, 'property'),
    meta('twitter:card', 'summary_large_image'),
    meta('twitter:title', site.title),
    meta('twitter:description', site.description),
    meta('twitter:image', image),
    meta('twitter:image:alt', site.imageAlt),
    `<script type="application/ld+json">${JSON.stringify(graph).replace(/</g, '\\u003c')}</script>`,
  ].join('\n    ')
}

export async function buildSite({
  outputDirectory = join(root, 'dist'),
  siteUrl = site.url,
  environment = 'development',
} = {}) {
  const canonical = productionOrigin(siteUrl)
  if (!['production', 'preview', 'development'].includes(environment))
    throw new Error('Unknown build environment.')
  const output = await physicalPath(resolve(outputDirectory))
  const project = await realpath(root)
  const defaultOutput = join(project, 'dist')
  if (inside(output, project) || (inside(project, output) && output !== defaultOutput)) {
    throw new Error(
      'Build output must not overlap source files; use demo/dist or a separate temporary directory.',
    )
  }
  const template = await readFile(join(source, 'index.html'), 'utf8')
  if (template.split(marker).length !== 2)
    throw new Error('The HTML template needs exactly one SEO marker.')
  const indexable = environment === 'production'
  const html = template.replace(marker, head(canonical, indexable))
  const styles = await Promise.all(
    ['fonts.css', 'tokens.css', 'components.css', 'style.css'].map((name) =>
      readFile(join(source, name), 'utf8'),
    ),
  )
  // Preserve the existing import/cascade order while avoiding extra CSS discoveries.
  const css = styles.map((text) => text.replace(/^@import\s+['"][^'"]+['"];\s*$/gm, '')).join('\n')
  await mkdir(output, { recursive: true })
  await cp(source, output, { recursive: true })
  await mkdir(join(output, 'lib'), { recursive: true })
  await cp(join(root, 'lib', 'fixtures.js'), join(output, 'lib', 'fixtures.js'))
  await writeFile(join(output, 'index.html'), html)
  await writeFile(join(output, 'style.css'), css)
  await writeFile(
    join(output, 'robots.txt'),
    `User-agent: *\nAllow: /\n${indexable ? `Sitemap: ${new URL('sitemap.xml', canonical).href}\n` : ''}`,
  )
  if (indexable) {
    await writeFile(
      join(output, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escapeAttribute(canonical)}</loc></url></urlset>\n`,
    )
  } else {
    try {
      await unlink(join(output, 'sitemap.xml'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return { outputDirectory: output, canonical, indexable }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildSite({
    siteUrl: process.env.SITE_URL || site.url,
    environment: process.env.VERCEL_ENV || 'development',
  })
  console.log(JSON.stringify(result))
}
