import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, openSync, readSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import { z } from 'zod'
import { parseAgentDoctorReport, SelectionSchema } from './report.js'
import { projectPortableReport, PortableFindingSchema } from './disclosure.js'
import { CoverageStateSchema } from './coverage.js'

const Digest = z.string().regex(/^[a-f0-9]{64}$/)
const Source = z
  .object({
    ref: Digest,
    kind: z.enum(['inventory', 'content']),
    contentDigest: Digest.nullable(),
    states: z.array(CoverageStateSchema).max(8),
  })
  .strict()
export const ConfigSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('ctxharness-config-snapshot'),
    profileVersion: z.literal(1),
    generatedAt: z.string().datetime(),
    selection: SelectionSchema,
    selectionIdentity: Digest,
    sourceGeneration: z.union([z.literal('unknown'), Digest]),
    complete: z.boolean(),
    sources: z.array(Source).max(100_000),
    findings: z
      .array(
        PortableFindingSchema.innerType()
          .omit({ ref: true })
          .extend({ source: z.literal('static') })
          .refine(
            (f) => !f.code.startsWith('runtime-'),
            'Runtime evidence is excluded from static snapshots.',
          ),
      )
      .max(100_000),
  })
  .strict()
  .refine(
    (s) => new Set(s.sources.map((f) => f.ref)).size === s.sources.length,
    'Duplicate sources.',
  )
export type ConfigSnapshot = z.infer<typeof ConfigSnapshotSchema>
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const ordered = <T>(values: T[]): T[] =>
  [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'))
export function parseConfigSnapshot(value: unknown): ConfigSnapshot {
  return ConfigSnapshotSchema.parse(value)
}

/** Explicit structural snapshot. No filesystem read or runtime-result promotion. */
export function buildConfigSnapshot(value: unknown, options: { home: string }): ConfigSnapshot {
  const report = parseAgentDoctorReport(value)
  if (report.coverage === undefined || report.budget === undefined)
    throw new Error('Configuration snapshots require coverage and static budget evidence.')
  const portable = projectPortableReport(report)
  const selection = {
    hosts: [...report.selection.hosts].sort(),
    scopes: [...report.selection.scopes].sort(),
  }
  const sources: ConfigSnapshot['sources'] = report.coverage.items.map((s) => ({
    ref: digest(
      JSON.stringify([
        'inventory',
        s.host,
        s.scope,
        s.layer,
        relative(s.scope === 'project' ? report.root : options.home, s.path),
      ]),
    ),
    kind: 'inventory',
    contentDigest: null,
    states: [...new Set(s.states)].sort(),
  }))
  for (const file of report.budget.files) {
    const scopes = new Set(file.attribution.map((a) => a.scope))
    for (const scope of selection.scopes.filter((scope) => scopes.size === 0 || scopes.has(scope)))
      for (const path of file.paths ?? [file.path])
        sources.push({
          ref: digest(
            JSON.stringify([
              'content',
              scope,
              relative(scope === 'project' ? report.root : options.home, path),
            ]),
          ),
          kind: 'content',
          contentDigest: file.contentDigest,
          states: ['discovered'],
        })
  }
  const generation = report.findings.find(
    (f) =>
      f.source === 'static' &&
      f.code === 'release-identity-valid' &&
      Digest.safeParse(f.expected).success,
  )?.expected
  return parseConfigSnapshot({
    schemaVersion: 1,
    kind: 'ctxharness-config-snapshot',
    profileVersion: 1,
    generatedAt: report.generatedAt,
    selection,
    selectionIdentity: digest(
      JSON.stringify({
        selection,
        project: selection.scopes.includes('project') ? report.root : null,
        global: selection.scopes.includes('global') ? options.home : null,
      }),
    ),
    sourceGeneration: generation ?? 'unknown',
    complete: report.budget.complete,
    sources: ordered([...new Map(sources.map((source) => [source.ref, source])).values()]),
    findings: ordered(
      portable.findings.filter((f) => f.source === 'static').map(({ ref: _ref, ...f }) => f),
    ),
  })
}
export interface ConfigSnapshotDiff {
  status: 'equal' | 'changed' | 'incomparable'
  evidence: 'complete' | 'incomplete'
  reason?: 'unsupported-or-invalid-input' | 'incompatible-selection'
  changes: { kind: 'added' | 'removed' | 'changed'; ref: string }[]
  findingsChanged: boolean
  generationChanged: boolean
}
/** Compare only: never writes a baseline and never evaluates health or performance. */
export function compareConfigSnapshots(before: unknown, after: unknown): ConfigSnapshotDiff {
  const a = ConfigSnapshotSchema.safeParse(before),
    b = ConfigSnapshotSchema.safeParse(after)
  const incomparable = (reason: ConfigSnapshotDiff['reason']): ConfigSnapshotDiff => ({
    status: 'incomparable',
    evidence: 'incomplete',
    ...(reason === undefined ? {} : { reason }),
    changes: [],
    findingsChanged: false,
    generationChanged: false,
  })
  if (!a.success || !b.success) return incomparable('unsupported-or-invalid-input')
  if (
    a.data.selectionIdentity !== b.data.selectionIdentity ||
    JSON.stringify(ordered(a.data.selection.hosts)) !==
      JSON.stringify(ordered(b.data.selection.hosts)) ||
    JSON.stringify(ordered(a.data.selection.scopes)) !==
      JSON.stringify(ordered(b.data.selection.scopes))
  )
    return incomparable('incompatible-selection')
  const left = new Map(a.data.sources.map((s) => [s.ref, { ...s, states: [...s.states].sort() }]))
  const right = new Map(b.data.sources.map((s) => [s.ref, { ...s, states: [...s.states].sort() }]))
  const changes: ConfigSnapshotDiff['changes'] = []
  for (const [ref, source] of left) {
    const other = right.get(ref)
    if (other === undefined) changes.push({ kind: 'removed', ref })
    else if (JSON.stringify(source) !== JSON.stringify(other))
      changes.push({ kind: 'changed', ref })
  }
  for (const ref of right.keys()) if (!left.has(ref)) changes.push({ kind: 'added', ref })
  const findingsChanged =
    JSON.stringify(ordered(a.data.findings)) !== JSON.stringify(ordered(b.data.findings))
  const generationChanged = a.data.sourceGeneration !== b.data.sourceGeneration
  return {
    status: changes.length > 0 || findingsChanged || generationChanged ? 'changed' : 'equal',
    evidence: a.data.complete && b.data.complete ? 'complete' : 'incomplete',
    changes: ordered(changes),
    findingsChanged,
    generationChanged,
  }
}
export function saveConfigSnapshot(value: unknown, path: string): void {
  const text = JSON.stringify(parseConfigSnapshot(value), null, 2) + '\n'
  if (Buffer.byteLength(text) > 8 * 1024 * 1024)
    throw new Error('Configuration snapshot exceeds the 8 MiB output limit.')
  writeFileSync(path, text, { flag: 'wx', mode: 0o600 })
}
export function loadConfigSnapshot(path: string): ConfigSnapshot {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error('Configuration snapshot must be a regular file.')
    if (stat.size > 8 * 1024 * 1024)
      throw new Error('Configuration snapshot exceeds the 8 MiB input limit.')
    const buffer = Buffer.alloc(stat.size + 1)
    let length = 0
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null)
      if (count === 0) break
      length += count
    }
    if (length > stat.size) throw new Error('Configuration snapshot changed during reading.')
    return parseConfigSnapshot(JSON.parse(buffer.subarray(0, length).toString('utf8')) as unknown)
  } finally {
    closeSync(fd)
  }
}
