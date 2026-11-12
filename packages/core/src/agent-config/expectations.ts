import { lstatSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import { readContext, withinRoot } from '../fs-boundary.js'
import type { AgentConfigFinding } from './types.js'

const identifier = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/)
const projectPath = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (path) =>
      !isAbsolute(path) &&
      !/[\\:\u0000]/u.test(path) &&
      path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
    'Expected a project-relative path without traversal.',
  )
const state = z.enum(['present', 'absent'])
const expectation = z.discriminatedUnion('kind', [
  z.object({ id: identifier, kind: z.literal('file'), path: projectPath, state }).strict(),
  z
    .object({
      id: identifier,
      kind: z.literal('mcp-server'),
      path: z.literal('.mcp.json'),
      name: identifier,
      state,
    })
    .strict(),
])

/** Explicit targets only: no profile inference, imports, globs or executable checks. */
export const ConfigExpectationsSchema = z
  .object({
    schemaVersion: z.literal(1),
    host: z.literal('claude'),
    scope: z.literal('project'),
    expectations: z.array(expectation).min(1).max(100),
  })
  .strict()
  .superRefine((contract, context) => {
    const ids = new Set<string>()
    const targets = new Set<string>()
    for (const item of contract.expectations) {
      const target = JSON.stringify([
        item.kind,
        item.path,
        item.kind === 'mcp-server' ? item.name : null,
      ])
      if (ids.has(item.id) || targets.has(target)) {
        context.addIssue({ code: 'custom', message: 'Duplicate expectation identifier or target.' })
      }
      ids.add(item.id)
      targets.add(target)
    }
  })
export type ConfigExpectations = z.infer<typeof ConfigExpectationsSchema>

export function parseConfigExpectations(value: unknown): ConfigExpectations {
  const parsed = ConfigExpectationsSchema.safeParse(value)
  if (!parsed.success) throw new Error('Invalid configuration expectations contract.')
  return parsed.data
}

/** Read one explicit regular file. Never follow markdown imports or execute content. */
function readBounded(path: string, root: string): string | undefined {
  const read = readContext(
    [path],
    { allowedRoots: [root], maxFiles: 1, maxBytes: 1_000_000 },
    false,
  )
  return read.complete && read.files.length === 1 ? read.files[0]?.content : undefined
}

export function loadConfigExpectations(path: string): ConfigExpectations {
  try {
    const absolute = resolve(path)
    if (!lstatSync(absolute).isFile()) throw new Error('Not a regular file.')
    const content = readBounded(absolute, dirname(absolute))
    if (content === undefined) throw new Error('Unavailable contract.')
    return parseConfigExpectations(JSON.parse(content) as unknown)
  } catch {
    // JSON parser and schema errors may contain arbitrary input, paths or values.
    throw new Error(
      'Configuration expectations must be valid JSON in a readable regular file of at most 1 MB.',
    )
  }
}

type Observation =
  | { state: 'present' | 'absent' | 'invalid' }
  | { state: 'unresolved'; reason: 'missing-evidence' | 'outside-boundary' }
const unresolved = (): Observation => ({ state: 'unresolved', reason: 'missing-evidence' })

type PathObservation =
  | { state: 'absent' }
  | { state: 'unresolved' }
  | {
      state: 'entry'
      path: string
      kind: 'file' | 'directory' | 'symlink' | 'special'
    }

/** A stable tree is required. lstat distinguishes ENOENT from permission failures. */
function observePath(root: string, path: string): PathObservation {
  let current = root
  const parts = path.split('/')
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]!)
    try {
      const stats = lstatSync(current)
      if (index < parts.length - 1) {
        if (!stats.isDirectory() || stats.isSymbolicLink()) return { state: 'unresolved' }
      } else {
        return {
          state: 'entry',
          path: current,
          kind: stats.isSymbolicLink()
            ? 'symlink'
            : stats.isFile()
              ? 'file'
              : stats.isDirectory()
                ? 'directory'
                : 'special',
        }
      }
    } catch (error) {
      return {
        state:
          typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
            ? 'absent'
            : 'unresolved',
      }
    }
  }
  return { state: 'unresolved' }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function observe(root: string, item: ConfigExpectations['expectations'][number]): Observation {
  if (!withinRoot(root, resolve(root, item.path)))
    return { state: 'unresolved', reason: 'outside-boundary' }
  const path = observePath(root, item.path)
  if (path.state === 'absent') return { state: 'absent' }
  if (path.state === 'unresolved') return unresolved()
  if (item.kind === 'file' && item.state === 'absent') return { state: 'present' }
  if (path.kind === 'directory') return item.kind === 'file' ? { state: 'invalid' } : unresolved()
  if (path.kind !== 'file') return unresolved()
  const content = readBounded(path.path, root)
  if (content === undefined) return unresolved()
  if (item.kind === 'file') return { state: 'present' }
  try {
    const parsed: unknown = JSON.parse(content)
    if (!isObject(parsed) || !isObject(parsed.mcpServers)) return unresolved()
    if (!Object.hasOwn(parsed.mcpServers, item.name)) return { state: 'absent' }
    return isObject(parsed.mcpServers[item.name]) ? { state: 'present' } : unresolved()
  } catch {
    return unresolved()
  }
}

/** Static declarations at named paths, never effective client loading or permissions. */
export function checkConfigExpectations(options: {
  root: string
  expectations: ConfigExpectations
}): AgentConfigFinding[] {
  // Validate even typed callers, before inspecting any target paths.
  const contract = parseConfigExpectations(options.expectations)
  let root: string | undefined
  try {
    const canonical = realpathSync(options.root)
    if (lstatSync(canonical).isDirectory()) root = canonical
  } catch {
    /* Every target remains unresolved when the project itself is unavailable. */
  }

  const findings: AgentConfigFinding[] = contract.expectations.map((item) => {
    const observed = root === undefined ? unresolved() : observe(root, item)
    const common = {
      host: contract.host,
      scope: contract.scope,
      ...(item.kind === 'mcp-server' ? { layer: 'mcp' as const } : {}),
      capability: item.id,
      path: resolve(options.root, item.path),
      expected: item.state,
      observed: observed.state,
    }
    if (observed.state === 'unresolved')
      return {
        ...common,
        code: 'config-expectation-unresolved',
        status: 'unknown',
        reason: observed.reason,
        message: 'The explicit configuration expectation could not be verified.',
      }
    const matches = observed.state === item.state
    return {
      ...common,
      code: matches ? 'config-expectation-match' : 'config-expectation-mismatch',
      status: matches ? 'pass' : 'fail',
      message: matches
        ? 'The explicit configuration expectation is satisfied.'
        : 'The explicit configuration expectation is not satisfied.',
    }
  })
  const satisfied = findings.every((finding) => finding.status === 'pass')
  findings.push({
    host: contract.host,
    scope: contract.scope,
    code: satisfied ? 'config-expectations-satisfied' : 'config-expectations-unsatisfied',
    status: satisfied ? 'pass' : 'fail',
    message: satisfied
      ? 'All explicit configuration expectations are satisfied.'
      : 'At least one explicit configuration expectation failed or remains unknown.',
  })
  return findings
}
