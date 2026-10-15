import { accessSync, constants, lstatSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'

import { ToolAvailabilitySchema, type ToolAvailability } from './tool-contract.js'
export { ToolAvailabilitySchema, PortableToolsSchema, portableToolAvailability } from './tool-contract.js'
export type { ToolAvailability } from './tool-contract.js'

const Request = z
  .object({
    tools: z.array(z.string().max(1024)).min(1).max(128),
    environment: z
      .object({
        identity: z.string().max(1024),
        path: z.string().max(65536),
        cwd: z.string().optional(),
        platform: z.enum(['posix', 'win32']).optional(),
      })
      .strict()
      .optional(),
    symlinks: z.enum(['reject', 'follow']).optional(),
    requirements: z
      .array(
        z
          .object({
            tool: z.string().max(1024),
            kind: z.enum(['project-requirement', 'caller-failed-attempt']),
          })
          .strict(),
      )
      .max(128)
      .optional(),
  })
  .strict()
export type ToolAvailabilityOptions = z.infer<typeof Request>
function missing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

/** Filesystem resolution only: no process spawn, shell startup, installer or network. */
export function diagnoseToolAvailability(value: ToolAvailabilityOptions): ToolAvailability {
  const options = Request.parse(value),
    environment = options.environment,
    symlinks = options.symlinks ?? 'reject'
  const declared = environment !== undefined && environment.identity.trim() !== ''
  const supported =
    declared && (environment.platform ?? 'posix') === 'posix' && process.platform !== 'win32'
  const results: ToolAvailability['results'] = []
  for (const tool of new Set(options.tools)) {
    const requirement = options.requirements?.find((r) => r.tool === tool)?.kind ?? 'none'
    let state: ToolAvailability['results'][number]['state'] = 'not-found',
      reason: ToolAvailability['results'][number]['reason'] = 'no-path-match',
      pathEntriesChecked = 0,
      resolvedPath: string | undefined
    if (tool === '' || tool === '.' || tool === '..' || /[\0/\\]/.test(tool)) {
      state = 'unknown-client-environment'
      reason = 'invalid-tool-name'
    } else if (!declared) {
      state = 'unknown-client-environment'
      reason = 'missing-environment'
    } else if (!supported) {
      state = 'unknown-client-environment'
      reason = 'unsupported-platform'
    } else {
      const entries = [...new Set(environment.path.split(':'))]
      const checked = new Set<string>()
      let unresolved: ToolAvailability['results'][number]['reason'] | undefined,
        nonExecutable = false
      if (entries.length > 256) {
        unresolved = 'path-limit'
      } else
        for (const entry of entries) {
          if (!isAbsolute(entry) && (!environment.cwd || !isAbsolute(environment.cwd))) {
            unresolved = 'relative-path-unresolved'
            continue
          }
          const directory = isAbsolute(entry) ? resolve(entry) : resolve(environment.cwd!, entry)
          if (checked.has(directory)) continue
          checked.add(directory)
          pathEntriesChecked++
          try {
            const dir = statSync(directory)
            if (!dir.isDirectory()) continue
            if ((dir.mode & 0o111) === 0) {
              unresolved = 'unreadable-path'
              continue
            }
            accessSync(directory, constants.X_OK)
            const candidate = join(directory, tool),
              link = lstatSync(candidate)
            if (link.isSymbolicLink() && symlinks === 'reject') {
              unresolved = 'symlink-rejected'
              continue
            }
            const target = link.isSymbolicLink() ? realpathSync(candidate) : candidate,
              stat = statSync(target)
            if (!stat.isFile() || (stat.mode & 0o111) === 0) {
              nonExecutable = true
              continue
            }
            try {
              accessSync(target, constants.X_OK)
            } catch {
              nonExecutable = true
              continue
            }
            state = 'installed'
            reason = 'executable-file'
            resolvedPath = target
            break
          } catch (error) {
            if (!missing(error)) unresolved = 'unreadable-path'
          }
        }
      if (state !== 'installed') {
        if (unresolved !== undefined) {
          state = 'unknown-client-environment'
          reason = unresolved
        } else if (nonExecutable) {
          state = 'not-executable'
          reason = 'not-executable'
        }
      }
    }
    results.push({
      tool,
      state,
      reason,
      requirement,
      advice: state === 'not-found' && requirement !== 'none' ? 'review-requirement' : 'none',
      authentication: 'unknown',
      permissions: 'unknown',
      pathEntriesChecked,
      ...(resolvedPath === undefined ? {} : { resolvedPath }),
    })
  }
  return ToolAvailabilitySchema.parse({
    profileVersion: 1,
    environment: {
      source: declared ? 'caller-declared' : 'unspecified',
      identity: declared ? environment.identity : null,
      platform: !declared ? 'unspecified' : supported ? 'posix' : 'unsupported',
      symlinks,
    },
    results,
  })
}
