import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { z } from 'zod'
import { readContext, type ReadPolicy } from '../fs-boundary.js'
import { buildConfigCoverage, type ConfigCoverage } from './coverage.js'
import type { AgentConfigInventory } from './types.js'

const Count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const Size = z
  .object({ utf8Bytes: Count, utf16CodeUnits: Count, estimatedTokens: Count })
  .strict()
  .refine(
    (m) => m.estimatedTokens === Math.ceil(m.utf16CodeUnits / 4),
    'Estimate must use UTF-16 chars/4.',
  )
const Category = z.enum([
  'instruction-body',
  'conditional-rule',
  'skill-catalog-metadata',
  'skill-body',
  'agent-body',
  'hook-config-metadata',
  'mcp-discoverable-metadata',
  'mixed-declarations',
  'other-static-content',
])
const Segment = z.object({ category: Category, measurement: Size }).strict()
const Attribution = z
  .object({
    host: z.enum(['claude', 'codex']),
    scope: z.enum(['project', 'global']),
    layer: z.enum(['instructions', 'skills', 'rules', 'agents', 'hooks', 'mcp', 'release']),
  })
  .strict()
const File = z
  .object({
    ref: z.string().regex(/^b[1-9][0-9]{0,5}$/),
    physicalRef: z.string().regex(/^p[1-9][0-9]{0,5}$/),
    contentGroup: z.string().regex(/^g[1-9][0-9]{0,5}$/),
    measurement: Size,
    segments: z.array(Segment).max(2),
    attribution: z.array(Attribution).max(1000),
  })
  .strict()
const Edge = z
  .object({
    from: z
      .string()
      .regex(/^p[1-9][0-9]{0,5}$/)
      .optional(),
    to: z
      .string()
      .regex(/^p[1-9][0-9]{0,5}$/)
      .optional(),
    status: z.enum([
      'included',
      'duplicate',
      'outside-boundary',
      'unavailable',
      'unsupported-reference',
      'file-limit',
      'byte-limit',
      'depth-limit',
      'edge-limit',
      'non-text',
    ]),
  })
  .strict()
const envelope = {
  profileVersion: z.literal(1),
  scope: z.literal('discovered-content-only'),
  methods: z
    .object({
      bytes: z.literal('utf8-bytes'),
      characters: z.literal('utf16-code-units'),
      estimate: z.literal('utf16-code-units-div-4-ceil'),
    })
    .strict(),
  loading: z.literal('unknown'),
  hiddenSystemPrompts: z.literal('unknown'),
  requestAssembly: z.literal('unknown'),
  complete: z.boolean(),
  totals: Size,
  edges: z.array(Edge).max(4097),
}
const totalsMatch = (r: {
  totals: z.infer<typeof Size>
  files: { measurement: z.infer<typeof Size> }[]
}) =>
  r.totals.utf8Bytes === r.files.reduce((n, f) => n + f.measurement.utf8Bytes, 0) &&
  r.totals.utf16CodeUnits === r.files.reduce((n, f) => n + f.measurement.utf16CodeUnits, 0)
export const StaticBudgetSchema = z
  .object({
    ...envelope,
    files: z
      .array(
        File.extend({
          path: z.string(),
          contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
        }).strict(),
      )
      .max(256),
  })
  .strict()
  .refine(totalsMatch, 'Inconsistent static totals.')
export const PortableBudgetSchema = z
  .object({ ...envelope, files: z.array(File).max(256) })
  .strict()
  .refine(totalsMatch, 'Inconsistent static totals.')
export type StaticBudget = z.infer<typeof StaticBudgetSchema>
function measure(content: string, bytes = Buffer.byteLength(content, 'utf8')) {
  return {
    utf8Bytes: bytes,
    utf16CodeUnits: content.length,
    estimatedTokens: Math.ceil(content.length / 4),
  }
}

/** Static source ledger. The caller selects inventory roots; input limits may only lower caps. */
export function buildStaticBudget(
  inventory: AgentConfigInventory,
  limits: Omit<ReadPolicy, 'allowedRoots'> = {},
  coverage: ConfigCoverage = buildConfigCoverage(inventory),
): StaticBudget {
  const sources = coverage.items
    .filter(
      (i) =>
        i.states.includes('discovered') &&
        !i.states.includes('outside-selection') &&
        (i.layer !== 'instructions' ||
          i.states.includes('declared') ||
          inventory.capabilities.some(
            (c) =>
              c.layer === 'instructions' &&
              c.host === i.host &&
              c.scope === i.scope &&
              c.path === i.path,
          )),
    )
    .filter((i) => {
      try {
        return !statSync(i.path).isDirectory()
      } catch {
        return true
      }
    })
  const read = readContext([...new Set(sources.map((s) => s.path))], {
    ...limits,
    allowedRoots: [...new Set(inventory.roots.map((r) => r.boundary))],
    maxDepth: limits.maxDepth ?? 3,
  })
  const paths = new Map<string, string>()
  const identityToRef = new Map(read.files.map((f, i) => [f.identity, 'p' + (i + 1)]))
  for (const e of read.edges.filter((e) => e.status === 'included' || e.status === 'duplicate')) {
    try {
      const s = statSync(e.to)
      const ref = identityToRef.get(s.dev + ':' + s.ino)
      if (ref) paths.set(e.to, ref)
    } catch {
      read.complete = false
    }
  }
  const groups = new Map<string, string>()
  const files: StaticBudget['files'] = []
  const rejected = new Set<string>()
  const attributionsByPath = new Map<string, z.infer<typeof Attribution>[]>()
  for (const [index, file] of read.files.entries()) {
    if (file.content.includes('\0') || Buffer.byteLength(file.content, 'utf8') !== file.bytes) {
      read.complete = false
      rejected.add(file.path)
      continue
    }
    const attribution = sources
      .filter((s) => {
        try {
          const t = statSync(s.path)
          return t.dev + ':' + t.ino === file.identity
        } catch {
          return false
        }
      })
      .map((s) => ({ host: s.host, scope: s.scope, layer: s.layer }))
    if (attribution.length === 0) {
      const parent = read.edges.find((e) => e.to === file.path && e.from !== undefined)?.from
      if (parent) attribution.push(...(attributionsByPath.get(parent) ?? []))
    }
    const uniqueAttribution = [...new Map(attribution.map((a) => [JSON.stringify(a), a])).values()]
    attributionsByPath.set(file.path, uniqueAttribution)
    const layers = new Set(attribution.map((a) => a.layer))
    const category: z.infer<typeof Category> =
      layers.size > 1
        ? 'mixed-declarations'
        : layers.has('skills')
          ? 'skill-body'
          : layers.has('rules')
            ? 'conditional-rule'
            : layers.has('agents')
              ? 'agent-body'
              : layers.has('mcp')
                ? 'mcp-discoverable-metadata'
                : layers.has('hooks')
                  ? 'hook-config-metadata'
                  : layers.has('instructions') ||
                      read.edges.some((e) => e.to === file.path && e.from !== undefined)
                    ? 'instruction-body'
                    : 'other-static-content'
    const frontmatter = layers.has('skills')
      ? /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/.exec(file.content)?.[0]
      : undefined
    const segments =
      frontmatter === undefined
        ? [{ category, measurement: measure(file.content, file.bytes) }]
        : [
            { category: 'skill-catalog-metadata' as const, measurement: measure(frontmatter) },
            {
              category: 'skill-body' as const,
              measurement: measure(file.content.slice(frontmatter.length)),
            },
          ]
    const contentDigest = createHash('sha256').update(file.content).digest('hex')
    if (!groups.has(contentDigest)) groups.set(contentDigest, 'g' + (groups.size + 1))
    files.push({
      ref: 'b' + (index + 1),
      physicalRef: 'p' + (index + 1),
      path: file.path,
      contentDigest,
      contentGroup: groups.get(contentDigest)!,
      measurement: measure(file.content, file.bytes),
      segments,
      attribution: uniqueAttribution,
    })
  }
  const edges: StaticBudget['edges'] = read.edges.map((e) => ({
    ...(e.from === undefined || !paths.has(e.from) ? {} : { from: paths.get(e.from)! }),
    ...(!paths.has(e.to) ? {} : { to: paths.get(e.to)! }),
    status: rejected.has(e.to) ? 'non-text' : e.status,
  }))
  const utf16CodeUnits = files.reduce((n, f) => n + f.measurement.utf16CodeUnits, 0)
  return StaticBudgetSchema.parse({
    profileVersion: 1,
    scope: 'discovered-content-only',
    methods: {
      bytes: 'utf8-bytes',
      characters: 'utf16-code-units',
      estimate: 'utf16-code-units-div-4-ceil',
    },
    loading: 'unknown',
    hiddenSystemPrompts: 'unknown',
    requestAssembly: 'unknown',
    complete: read.complete,
    totals: {
      utf8Bytes: files.reduce((n, f) => n + f.measurement.utf8Bytes, 0),
      utf16CodeUnits,
      estimatedTokens: Math.ceil(utf16CodeUnits / 4),
    },
    files,
    edges,
  })
}
export function portableBudget(value: unknown): z.infer<typeof PortableBudgetSchema> {
  const b = StaticBudgetSchema.parse(value)
  return PortableBudgetSchema.parse({
    ...b,
    files: b.files.map((f) => ({
      ref: f.ref,
      physicalRef: f.physicalRef,
      contentGroup: f.contentGroup,
      measurement: f.measurement,
      segments: f.segments,
      attribution: f.attribution,
    })),
  })
}
