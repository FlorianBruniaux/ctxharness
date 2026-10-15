import { z } from 'zod'
import { portableBudget, PortableBudgetSchema } from './budget.js'
import { portableCoverage, PortableCoverageSchema } from './coverage.js'
import {
  countsMatch,
  LayerSchema,
  parseAgentDoctorReport,
  SelectionSchema,
  StatusSchema,
  SummarySchema,
  HostSchema,
  ScopeSchema,
} from './report.js'

/** Closed vocabulary: new unknown codes are projected to unrecognized-finding. */
export const PortableCodeSchema = z.enum([
  'unrecognized-finding',
  'configured-root-unavailable',
  'path-outside-boundary',
  'instruction-valid',
  'instruction-empty',
  'instruction-shadowed',
  'instruction-evidence-unavailable',
  'skill-valid',
  'skill-invalid',
  'skill-description-missing',
  'skill-name-collision',
  'skill-reference-missing',
  'skill-reference-outside-boundary',
  'skill-evidence-unavailable',
  'claude-rule-valid',
  'claude-rule-glob-invalid',
  'claude-rule-frontmatter-invalid',
  'rule-evidence-unavailable',
  'agent-valid',
  'agent-invalid',
  'agent-documentation',
  'agent-frontmatter-nonstrict',
  'agent-evidence-unavailable',
  'hook-config-invalid',
  'hook-config-empty',
  'hook-command-invalid',
  'hook-command-resolved',
  'hook-command-unresolved',
  'hook-command-unverified',
  'hook-event-unknown',
  'hook-handler-unsupported',
  'hook-matcher-ignored',
  'hook-source-outside-boundary',
  'mcp-config-invalid',
  'mcp-config-valid',
  'mcp-literal-secret',
  'current-release-unavailable',
  'current-release-outside-boundary',
  'current-release-invalid-target',
  'current-release-not-symlink',
  'current-release-valid',
  'release-manifest-invalid',
  'release-identity-valid',
  'release-identity-mismatch',
  'release-artifact-set-mismatch',
  'release-evidence-stale',
  'release-output-hash-valid',
  'release-output-hash-mismatch',
  'release-output-outside-boundary',
  'release-output-link-valid',
  'release-output-link-mismatch',
  'release-output-unavailable',
  'release-output-mode-mismatch',
  'host-exception-declared',
  'host-parity-divergence',
  'live-output-divergence',
  'live-output-match',
  'live-output-outside-boundary',
  'live-output-unavailable',
  'runtime-evidence-unavailable',
  'runtime-canary-result',
])
const RefSchema = z.string().regex(/^f[1-9][0-9]{0,5}$/)
export const PortableFindingSchema = z
  .object({
    ref: RefSchema,
    code: PortableCodeSchema,
    status: StatusSchema,
    source: z.enum(['static', 'runtime']),
    mandatory: z.boolean(),
    host: HostSchema.optional(),
    scope: ScopeSchema.optional(),
    layer: LayerSchema.optional(),
  })
  .strict()
  .refine(
    (f) => f.source !== 'runtime' || !f.mandatory,
    'Runtime results are imported declarations.',
  )
export const PortableReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('ctxharness-portable'),
    profileVersion: z.literal(1),
    coverage: PortableCoverageSchema.optional(),
    budget: PortableBudgetSchema.optional(),
    selection: SelectionSchema,
    summary: SummarySchema,
    runtimeEvidence: z.enum(['not-provided', 'unavailable', 'timestamped', 'declared-signature']),
    findings: z.array(PortableFindingSchema).max(100_000),
  })
  .strict()
  .refine(countsMatch, 'Inconsistent finding counts.')
  .refine(
    (r) => new Set(r.findings.map((f) => f.ref)).size === r.findings.length,
    'Duplicate references.',
  )
export type PortableReport = z.infer<typeof PortableReportSchema>
export function parsePortableReport(value: unknown): PortableReport {
  return PortableReportSchema.parse(value)
}

/** Allowlist projection. Opaque references do not guarantee anonymization. */
export function projectPortableReport(value: unknown): PortableReport {
  const report = parseAgentDoctorReport(value)
  return parsePortableReport({
    schemaVersion: 1,
    kind: 'ctxharness-portable',
    profileVersion: 1,
    ...(report.budget === undefined ? {} : { budget: portableBudget(report.budget) }),
    ...(report.coverage === undefined ? {} : { coverage: portableCoverage(report.coverage) }),
    selection: report.selection,
    summary: report.summary,
    runtimeEvidence:
      report.runtimeEvidence?.kind ??
      (report.findings.some((f) => f.source === 'runtime') ? 'unavailable' : 'not-provided'),
    findings: report.findings.map((f, index) => ({
      ref: 'f' + (index + 1),
      code: PortableCodeSchema.safeParse(f.code).success ? f.code : 'unrecognized-finding',
      status: f.status,
      source: f.source,
      mandatory: f.mandatory,
      ...(f.host === undefined ? {} : { host: f.host }),
      ...(f.scope === undefined ? {} : { scope: f.scope }),
      ...(f.layer === undefined ? {} : { layer: f.layer }),
    })),
  })
}

/** Explicit local-only correspondence, never included by the portable projector. */
export function buildPrivateSourceMap(value: unknown): { ref: string; path: string }[] {
  return parseAgentDoctorReport(value).findings.flatMap((f, index) =>
    f.path === undefined ? [] : [{ ref: 'f' + (index + 1), path: f.path }],
  )
}
