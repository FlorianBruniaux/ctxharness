import { z } from 'zod'

/** Shared v1 data contract; diagnosis is provided only by the optional extension. */
const Requirement = z.enum(['project-requirement', 'caller-failed-attempt', 'none'])
const State = z.enum(['installed', 'not-found', 'not-executable', 'unknown-client-environment'])
const Reason = z.enum([
  'executable-file',
  'no-path-match',
  'not-executable',
  'missing-environment',
  'invalid-tool-name',
  'unreadable-path',
  'unsupported-platform',
  'symlink-rejected',
  'relative-path-unresolved',
  'path-limit',
])
const Result = z
  .object({
    state: State,
    reason: Reason,
    requirement: Requirement,
    advice: z.enum(['none', 'review-requirement']),
    authentication: z.literal('unknown'),
    permissions: z.literal('unknown'),
    pathEntriesChecked: z.number().int().min(0).max(256),
  })
  .strict()
const Environment = z
  .object({
    source: z.enum(['caller-declared', 'unspecified']),
    platform: z.enum(['posix', 'unsupported', 'unspecified']),
    symlinks: z.enum(['reject', 'follow']),
  })
  .strict()
export const ToolAvailabilitySchema = z
  .object({
    profileVersion: z.literal(1),
    environment: Environment.extend({ identity: z.string().max(1024).nullable() }).strict(),
    results: z
      .array(
        Result.extend({ tool: z.string().max(1024), resolvedPath: z.string().optional() }).strict(),
      )
      .max(128),
  })
  .strict()
export const PortableToolsSchema = z
  .object({
    profileVersion: z.literal(1),
    environment: Environment,
    results: z
      .array(Result.extend({ ref: z.string().regex(/^t[1-9][0-9]{0,2}$/) }).strict())
      .max(128),
  })
  .strict()
export type ToolAvailability = z.infer<typeof ToolAvailabilitySchema>

export function portableToolAvailability(value: unknown): z.infer<typeof PortableToolsSchema> {
  const report = ToolAvailabilitySchema.parse(value)
  return PortableToolsSchema.parse({
    profileVersion: 1,
    environment: {
      source: report.environment.source,
      platform: report.environment.platform,
      symlinks: report.environment.symlinks,
    },
    results: report.results.map(({ tool: _tool, resolvedPath: _path, ...result }, index) => ({
      ...result,
      ref: 't' + (index + 1),
    })),
  })
}
