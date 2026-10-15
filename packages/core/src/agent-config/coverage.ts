import { dirname } from 'node:path'
import { z } from 'zod'
import { scanAgentConfig } from '../scanners/index.js'
import { readContext } from '../fs-boundary.js'
import type { AgentConfigEvidence, AgentConfigFinding, AgentConfigInventory } from './types.js'

export const CoverageStateSchema = z.enum([
  'discovered',
  'declared',
  'statically-applicable',
  'conditional',
  'shadowed',
  'invalid',
  'outside-selection',
  'unresolved',
])
const Host = z.enum(['claude', 'codex'])
const Scope = z.enum(['project', 'global'])
const Layer = z.enum(['instructions', 'skills', 'rules', 'agents', 'hooks', 'mcp', 'release'])
const SupportSchema = z
  .object({
    host: Host,
    surface: z.enum([
      'instructions',
      'imports',
      'rules',
      'skills',
      'agents',
      'hooks',
      'mcp',
      'release',
      'memory',
      'output-styles',
      'plugins',
      'commands',
      'managed-settings',
    ]),
    status: z.enum(['qualified', 'unsupported', 'unobserved']),
  })
  .strict()
const Item = z
  .object({
    host: Host,
    scope: Scope,
    layer: Layer,
    states: z.array(CoverageStateSchema).min(1).max(8),
    loaded: z.literal('unknown'),
    executed: z.literal('unknown'),
    beneficial: z.literal('unknown'),
  })
  .strict()
const LocalItem = Item.extend({
  path: z.string(),
  evidence: z.array(
    z
      .object({ host: Host, scope: Scope, layer: Layer, root: z.string(), path: z.string() })
      .strict(),
  ),
}).strict()
const envelope = {
  profileVersion: z.literal(1),
  resolution: z.literal('partial'),
  nativeClient: z.literal('unobserved'),
  platform: z.literal('unqualified'),
  support: z.array(SupportSchema).max(100),
}
export const ConfigCoverageSchema = z
  .object({ ...envelope, items: z.array(LocalItem).max(100_000) })
  .strict()
export const PortableCoverageSchema = z
  .object({
    ...envelope,
    items: z
      .array(Item.extend({ ref: z.string().regex(/^c[1-9][0-9]{0,5}$/) }).strict())
      .max(100_000),
  })
  .strict()
export type ConfigCoverage = z.infer<typeof ConfigCoverageSchema>

/** Scope-limited support inventory, never an effective native configuration claim. */
export function buildConfigCoverage(
  inventory: AgentConfigInventory,
  findings: AgentConfigFinding[] = scanAgentConfig(inventory),
): ConfigCoverage {
  const items = new Map<string, z.infer<typeof LocalItem>>()
  const get = (evidence: AgentConfigEvidence) => {
    const key = [evidence.host, evidence.scope, evidence.layer, evidence.path].join(':')
    let item = items.get(key)
    if (item === undefined) {
      item = {
        host: evidence.host,
        scope: evidence.scope,
        layer: evidence.layer,
        path: evidence.path,
        evidence: [evidence],
        states: ['discovered'],
        loaded: 'unknown',
        executed: 'unknown',
        beneficial: 'unknown',
      }
      items.set(key, item)
    }
    return item
  }
  const add = (item: z.infer<typeof LocalItem>, state: z.infer<typeof CoverageStateSchema>) => {
    if (!item.states.includes(state)) item.states.push(state)
  }
  for (const capability of inventory.capabilities) get(capability.evidence)
  for (const skill of inventory.skills) for (const evidence of skill.evidence) get(evidence)
  for (const f of findings) {
    const evidence =
      f.evidence ??
      (f.path && f.host && f.scope && f.layer
        ? [
            {
              host: f.host,
              scope: f.scope,
              layer: f.layer,
              root: f.scope === 'project' ? inventory.root : inventory.home,
              path: f.path,
            },
          ]
        : [])
    for (const source of evidence.slice(0, 1)) {
      const item = get(source)
      if (f.code === 'configured-root-unavailable') item.states = []
      if (f.status === 'unknown') add(item, 'unresolved')
      else if (f.reason !== 'outside-boundary') add(item, 'declared')
      if (f.status === 'fail') add(item, 'invalid')
      if (f.reason === 'outside-boundary') add(item, 'outside-selection')
      if (f.code === 'instruction-shadowed') add(item, 'shadowed')
      if (f.code === 'claude-rule-frontmatter-invalid') add(item, 'unresolved')
    }
  }
  const allowedRoots = [...new Set(inventory.roots.map((r) => r.boundary))]
  for (const item of [...items.values()].filter(
    (i) =>
      i.layer === 'instructions' && i.states.includes('declared') && !i.states.includes('invalid'),
  )) {
    const read = readContext([item.path], { allowedRoots, maxDepth: 3 })
    for (const edge of read.edges.filter((e) => e.from !== undefined)) {
      const imported = get({ ...item.evidence[0]!, path: edge.to })
      if (edge.status === 'outside-boundary') {
        imported.states = ['outside-selection', 'unresolved']
      } else if (edge.status !== 'included' && edge.status !== 'duplicate')
        imported.states = ['unresolved']
    }
  }
  for (const item of items.values()) {
    if (
      item.states.includes('shadowed') ||
      item.states.includes('invalid') ||
      item.states.includes('outside-selection') ||
      item.states.includes('unresolved')
    )
      continue
    if (item.layer === 'instructions' && item.states.includes('declared')) {
      const boundary = item.scope === 'project' ? inventory.root : inventory.home
      add(item, dirname(item.path) === boundary ? 'statically-applicable' : 'conditional')
    } else if (item.layer === 'rules' || item.layer === 'skills' || item.layer === 'agents')
      add(item, 'conditional')
    else add(item, 'unresolved')
  }
  const hosts = [...new Set(inventory.roots.map((r) => r.host))]
  const support: ConfigCoverage['support'] = hosts.flatMap((host) =>
    (
      [
        'instructions',
        'imports',
        'rules',
        'skills',
        'agents',
        'hooks',
        'mcp',
        'release',
        'memory',
        'output-styles',
        'plugins',
        'commands',
        'managed-settings',
      ] as const
    ).map((surface) => ({
      host,
      surface,
      status:
        ['memory', 'output-styles', 'plugins', 'commands', 'managed-settings'].includes(surface) ||
        (host === 'codex' && (surface === 'rules' || surface === 'imports'))
          ? ('unsupported' as const)
          : surface === 'release'
            ? ('unobserved' as const)
            : ('qualified' as const),
    })),
  )
  return ConfigCoverageSchema.parse({
    profileVersion: 1,
    resolution: 'partial',
    nativeClient: 'unobserved',
    platform: 'unqualified',
    items: [...items.values()],
    support,
  })
}

export function portableCoverage(value: unknown): z.infer<typeof PortableCoverageSchema> {
  const coverage = ConfigCoverageSchema.parse(value)
  return PortableCoverageSchema.parse({
    ...coverage,
    items: coverage.items.map((item, index) => ({
      ref: 'c' + (index + 1),
      host: item.host,
      scope: item.scope,
      layer: item.layer,
      states: item.states,
      loaded: item.loaded,
      executed: item.executed,
      beneficial: item.beneficial,
    })),
  })
}
