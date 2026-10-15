import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { inventoryAgentConfig } from './inventory.js'
import { scanAgentConfig } from '../scanners/index.js'
import { validateAgentConfigRelease } from './release.js'
import { checkAgentConfigParity } from './parity.js'
import type { AgentConfigFinding, AgentHost, AgentConfigScope } from './types.js'
import { z } from 'zod'
import { diagnoseToolAvailability, type ToolAvailabilityOptions } from './tool-availability.js'
import { buildStaticBudget, StaticBudgetSchema, type StaticBudget } from './budget.js'
import { buildConfigCoverage, ConfigCoverageSchema, type ConfigCoverage } from './coverage.js'
import { ToolAvailabilitySchema, type ToolAvailability } from './tool-contract.js'

export interface AgentDoctorOptions {
  toolRequest?: ToolAvailabilityOptions
  includeCoverage?: boolean
  includeBudget?: boolean
  root: string
  home: string
  hosts: AgentHost[]
  scopes: AgentConfigScope[]
  runtimeEvidencePath?: string | undefined
  cwd?: string
}

export type AgentDoctorStatus = AgentConfigFinding['status']

export type AgentDoctorFinding = AgentConfigFinding & {
  source: 'static' | 'runtime'
  mandatory: boolean
}

interface RuntimeEvidenceMetadata {
  path: string
  kind: 'timestamped' | 'declared-signature'
  generatedAt?: string
  signature?: {
    algorithm: string
    keyId: string
  }
}

interface RuntimeEvidenceResult {
  host: AgentHost
  scope?: AgentConfigScope
  capability: string
  status: AgentDoctorStatus
  message: string
}

interface RuntimeEvidenceLoadResult {
  metadata?: RuntimeEvidenceMetadata
  findings: AgentDoctorFinding[]
}

export interface AgentDoctorReport {
  toolAvailability?: ToolAvailability
  coverage?: ConfigCoverage
  budget?: StaticBudget
  schemaVersion: 1
  command: 'doctor'
  mode: 'agent-config'
  generatedAt: string
  root: string
  selection: {
    hosts: AgentHost[]
    scopes: AgentConfigScope[]
  }
  runtimeEvidence: RuntimeEvidenceMetadata | null
  summary: {
    pass: number
    warn: number
    fail: number
    unknown: number
    notApplicable: number
    mandatoryFailures: number
  }
  findings: AgentDoctorFinding[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function runtimeEvidenceUnknown(path: string, message: string): RuntimeEvidenceLoadResult {
  return {
    findings: [
      {
        code: 'runtime-evidence-unavailable',
        status: 'unknown',
        reason: 'missing-evidence',
        message,
        path,
        source: 'runtime',
        mandatory: false,
      },
    ],
  }
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value))
}

function parseRuntimeResult(value: unknown): RuntimeEvidenceResult | null {
  if (!isRecord(value)) return null
  const { host, scope, capability, status, message } = value
  if (host !== 'claude' && host !== 'codex') return null
  if (scope !== undefined && scope !== 'project' && scope !== 'global') return null
  if (typeof capability !== 'string' || capability.length === 0) return null
  if (
    status !== 'pass' &&
    status !== 'warn' &&
    status !== 'fail' &&
    status !== 'unknown' &&
    status !== 'not-applicable'
  )
    return null
  if (typeof message !== 'string' || message.length === 0) return null
  return {
    host,
    ...(scope === undefined ? {} : { scope }),
    capability,
    status,
    message,
  }
}

function loadRuntimeEvidence(
  requestedPath: string,
  cwd: string,
  hosts: AgentHost[],
  scopes: AgentConfigScope[],
): RuntimeEvidenceLoadResult {
  const path = resolve(cwd, requestedPath)
  let parsed: unknown
  try {
    if (statSync(path).size > 1_000_000) {
      return runtimeEvidenceUnknown(path, 'Runtime evidence exceeds the 1 MB local input limit.')
    }
    const contents = readFileSync(path, 'utf8')
    parsed = JSON.parse(contents)
  } catch {
    return runtimeEvidenceUnknown(path, 'Runtime evidence is missing, unreadable, or invalid JSON.')
  }

  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.results)) {
    return runtimeEvidenceUnknown(path, 'Runtime evidence does not match schema version 1.')
  }

  let metadata: RuntimeEvidenceMetadata
  if (isValidTimestamp(parsed.generatedAt)) {
    metadata = { path, kind: 'timestamped', generatedAt: parsed.generatedAt }
  } else if (
    isRecord(parsed.signature) &&
    typeof parsed.signature.algorithm === 'string' &&
    parsed.signature.algorithm.length > 0 &&
    typeof parsed.signature.keyId === 'string' &&
    parsed.signature.keyId.length > 0 &&
    typeof parsed.signature.value === 'string' &&
    parsed.signature.value.length > 0
  ) {
    metadata = {
      path,
      kind: 'declared-signature',
      signature: {
        algorithm: parsed.signature.algorithm,
        keyId: parsed.signature.keyId,
      },
    }
  } else {
    return runtimeEvidenceUnknown(
      path,
      'Runtime evidence must declare a valid generatedAt timestamp or signature metadata.',
    )
  }

  const results = parsed.results.map(parseRuntimeResult)
  if (results.some((result) => result === null)) {
    return runtimeEvidenceUnknown(path, 'Runtime evidence contains an invalid canary result.')
  }

  const findings = (results as RuntimeEvidenceResult[])
    .filter((result) => hosts.includes(result.host))
    .filter((result) => result.scope === undefined || scopes.includes(result.scope))
    .map(
      (result): AgentDoctorFinding => ({
        code: 'runtime-canary-result',
        status: result.status,
        ...(result.status === 'unknown' ? { reason: 'missing-evidence' as const } : {}),
        message: result.message,
        host: result.host,
        ...(result.scope === undefined ? {} : { scope: result.scope }),
        capability: result.capability,
        source: 'runtime',
        mandatory: false,
      }),
    )

  return { metadata, findings }
}

function includeSelectedFinding(
  finding: AgentConfigFinding,
  hosts: AgentHost[],
  scopes: AgentConfigScope[],
): boolean {
  if (finding.host !== undefined && !hosts.includes(finding.host)) return false
  if (finding.scope !== undefined && !scopes.includes(finding.scope)) return false
  return true
}

function staticFinding(finding: AgentConfigFinding): AgentDoctorFinding {
  return {
    ...finding,
    source: 'static',
    mandatory: finding.status === 'fail',
  }
}

export function buildAgentDoctorReport(options: AgentDoctorOptions): AgentDoctorReport {
  const { root, home, hosts, scopes, runtimeEvidencePath, cwd = root } = options
  const inventory = inventoryAgentConfig({ root, home, hosts, scopes })
  const findings = scanAgentConfig(inventory)
    .filter((finding) => includeSelectedFinding(finding, hosts, scopes))
    .map(staticFinding)

  if (scopes.includes('global')) {
    const releaseResult = validateAgentConfigRelease({
      configRoot: join(home, '.config', 'ai-agents'),
    })
    findings.push(
      ...releaseResult.findings
        .filter((finding) => includeSelectedFinding(finding, hosts, scopes))
        .map(staticFinding),
    )
    if (releaseResult.release !== undefined) {
      findings.push(
        ...checkAgentConfigParity({
          release: releaseResult.release,
          home,
          policy: { undeclaredDivergence: 'fail' },
        })
          .filter((finding) => includeSelectedFinding(finding, hosts, scopes))
          .map(staticFinding),
      )
    }
  }

  let runtimeEvidence: RuntimeEvidenceMetadata | null = null
  if (runtimeEvidencePath !== undefined) {
    const loaded = loadRuntimeEvidence(runtimeEvidencePath, cwd, hosts, scopes)
    runtimeEvidence = loaded.metadata ?? null
    findings.push(...loaded.findings)
  }

  const coverage =
    options.includeCoverage || options.includeBudget
      ? buildConfigCoverage(
          inventory,
          findings.filter((f) => f.source === 'static'),
        )
      : undefined
  const count = (status: AgentDoctorStatus): number =>
    findings.filter((finding) => finding.status === status).length
  return {
    ...(options.toolRequest === undefined ? {} : { toolAvailability: diagnoseToolAvailability(options.toolRequest) }),
    schemaVersion: 1,
    command: 'doctor',
    mode: 'agent-config',
    generatedAt: new Date().toISOString(),
    root,
    selection: { hosts, scopes },
    runtimeEvidence,
    summary: {
      pass: count('pass'),
      warn: count('warn'),
      fail: count('fail'),
      unknown: count('unknown'),
      notApplicable: count('not-applicable'),
      mandatoryFailures: findings.filter(
        (finding) => finding.status === 'fail' && finding.mandatory,
      ).length,
    },
    findings,
    ...(options.includeCoverage && coverage !== undefined ? { coverage } : {}),
    ...(options.includeBudget ? { budget: buildStaticBudget(inventory, {}, coverage) } : {}),
  }
}

export const HostSchema = z.enum(['claude', 'codex'])
export const ScopeSchema = z.enum(['project', 'global'])
export const LayerSchema = z.enum([
  'instructions',
  'skills',
  'rules',
  'agents',
  'hooks',
  'mcp',
  'release',
])
export const StatusSchema = z.enum(['pass', 'warn', 'fail', 'unknown', 'not-applicable'])
export const SelectionSchema = z
  .object({ hosts: z.array(HostSchema).min(1).max(2), scopes: z.array(ScopeSchema).min(1).max(2) })
  .strict()
  .refine(
    (s) => new Set(s.hosts).size === s.hosts.length && new Set(s.scopes).size === s.scopes.length,
  )
const count = z.number().int().nonnegative().safe()
export const SummarySchema = z
  .object({
    pass: count,
    warn: count,
    fail: count,
    unknown: count,
    notApplicable: count,
    mandatoryFailures: count,
  })
  .strict()
const EvidenceSchema = z
  .object({
    host: HostSchema,
    scope: ScopeSchema,
    layer: LayerSchema,
    root: z.string(),
    path: z.string(),
  })
  .strict()
export const DoctorFindingSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    status: StatusSchema,
    source: z.enum(['static', 'runtime']),
    mandatory: z.boolean(),
    reason: z.enum(['missing-evidence', 'outside-boundary']).optional(),
    host: HostSchema.optional(),
    scope: ScopeSchema.optional(),
    layer: LayerSchema.optional(),
    path: z.string().optional(),
    evidence: z.array(EvidenceSchema).optional(),
    server: z.string().optional(),
    capability: z.string().optional(),
    expected: z.string().optional(),
    observed: z.string().optional(),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.status === 'unknown' && f.reason === undefined)
      ctx.addIssue({ code: 'custom', message: 'Unknown requires a reason.' })
    if (f.source === 'runtime' && f.mandatory)
      ctx.addIssue({ code: 'custom', message: 'Imported runtime results cannot be mandatory.' })
  })
export function summarizeFindings(
  findings: readonly { status: AgentDoctorStatus; mandatory: boolean }[],
): AgentDoctorReport['summary'] {
  return {
    pass: findings.filter((f) => f.status === 'pass').length,
    warn: findings.filter((f) => f.status === 'warn').length,
    fail: findings.filter((f) => f.status === 'fail').length,
    unknown: findings.filter((f) => f.status === 'unknown').length,
    notApplicable: findings.filter((f) => f.status === 'not-applicable').length,
    mandatoryFailures: findings.filter((f) => f.status === 'fail' && f.mandatory).length,
  }
}
export function countsMatch(report: {
  summary: AgentDoctorReport['summary']
  findings: { status: AgentDoctorStatus; mandatory: boolean }[]
}): boolean {
  const expected = summarizeFindings(report.findings)
  return (Object.keys(expected) as (keyof typeof expected)[]).every(
    (k) => report.summary[k] === expected[k],
  )
}
export const AgentDoctorReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    command: z.literal('doctor'),
    mode: z.literal('agent-config'),
    generatedAt: z.string().datetime(),
    root: z.string(),
    selection: SelectionSchema,
    runtimeEvidence: z
      .object({
        path: z.string(),
        kind: z.enum(['timestamped', 'declared-signature']),
        generatedAt: z.string().optional(),
        signature: z.object({ algorithm: z.string(), keyId: z.string() }).strict().optional(),
      })
      .strict()
      .nullable(),
  coverage: ConfigCoverageSchema.optional(),
    budget: StaticBudgetSchema.optional(),
    toolAvailability: ToolAvailabilitySchema.optional(),
    summary: SummarySchema,
    findings: z.array(DoctorFindingSchema).max(100_000),
  })
  .strict()
  .refine(countsMatch, 'Inconsistent finding counts.')

/** Validates local untrusted input without elevating imported evidence. */
export function parseAgentDoctorReport(value: unknown): AgentDoctorReport {
  return AgentDoctorReportSchema.parse(value) as AgentDoctorReport
}
