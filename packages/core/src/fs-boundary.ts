import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export type ReadReason =
  | 'outside-boundary'
  | 'unavailable'
  | 'unsupported-reference'
  | 'file-limit'
  | 'byte-limit'
  | 'depth-limit'
  | 'edge-limit'
export interface ReadPolicy {
  readonly allowedRoots: readonly string[]
  readonly maxFiles?: number
  readonly maxBytes?: number
  readonly maxDepth?: number
}
export interface ContextFile {
  path: string
  identity: string
  content: string
  bytes: number
}
export interface ImportEdge {
  from?: string
  to: string
  status: 'included' | 'duplicate' | ReadReason
}
export interface ContextRead {
  files: ContextFile[]
  edges: ImportEdge[]
  complete: boolean
}

export function withinRoot(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

/** Supported local markdown references; other references remain unresolved. */
export function contextReferences(content: string): { reference: string; supported: boolean }[] {
  const references: { reference: string; supported: boolean }[] = []
  for (const match of content.matchAll(/(?:^|\s)@([^\s`<>"']+)/g)) {
    const reference = (match[1] ?? '').replace(/[),;]+$/, '')
    if (!/\.md(?:$|[?#])/.test(reference)) continue
    references.push({ reference, supported: /^[\w./-]+\.md$/.test(reference) })
  }
  return references
}

/** Bounded synchronous reads. Stable trees required; path checks are not an OS sandbox. */
export function readContext(
  entries: readonly string[],
  policy: ReadPolicy,
  followImports = true,
): ContextRead {
  const roots = policy.allowedRoots.flatMap((root) => {
    try {
      return [realpathSync(root)]
    } catch {
      return []
    }
  })
  const cap = (n: number | undefined, fallback: number) =>
    n === undefined || !Number.isFinite(n)
      ? fallback
      : Math.max(0, Math.min(Math.floor(n), fallback))
  const maxFiles = cap(policy.maxFiles, 256)
  const maxBytes = cap(policy.maxBytes, 4 * 1024 * 1024)
  const maxDepth = cap(policy.maxDepth, 32)
  const result: ContextRead = { files: [], edges: [], complete: true }
  const seen = new Map<string, ContextFile>()
  const expandedPaths = new Set<string>()
  const queue: { candidate: string; depth: number; from?: string }[] = []
  let truncated = false
  const enqueue = (candidate: string, depth: number, from?: string) => {
    if (queue.length >= 4096) {
      truncated = true
      result.complete = false
      return
    }
    queue.push({ candidate, depth, ...(from === undefined ? {} : { from }) })
  }
  let bytes = 0
  const edge = (from: string | undefined, to: string, status: ImportEdge['status']) => {
    if (result.edges.length >= 4096 && status !== 'edge-limit') {
      result.complete = false
      return
    }
    result.edges.push({ ...(from === undefined ? {} : { from }), to, status })
    if (status !== 'included' && status !== 'duplicate') result.complete = false
  }
  const expand = (path: string, content: string, depth: number) => {
    if (!followImports) return
    expandedPaths.add(path)
    for (const ref of contextReferences(content)) {
      if (!ref.supported) edge(path, ref.reference, 'unsupported-reference')
      else enqueue(resolve(dirname(path), ref.reference), depth - 1, path)
    }
  }
  const visit = (candidate: string, depth: number, from?: string): void => {
    if (result.edges.length >= 4096) {
      result.complete = false
      return
    }
    let path: string
    try {
      path = realpathSync(candidate)
    } catch {
      edge(from, candidate, 'unavailable')
      return
    }
    if (!roots.some((root) => withinRoot(root, path))) {
      edge(from, candidate, 'outside-boundary')
      return
    }
    let fd: number | undefined
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
      const stat = fstatSync(fd)
      if (!stat.isFile()) {
        edge(from, candidate, 'unavailable')
        return
      }
      const identity = `${stat.dev}:${stat.ino}`
      const cached = seen.get(identity)
      if (cached !== undefined && (!followImports || expandedPaths.has(path))) {
        edge(from, path, 'duplicate')
        return
      }
      if (depth <= 0) {
        edge(from, path, 'depth-limit')
        return
      }
      if (cached !== undefined) {
        edge(from, path, 'duplicate')
        expand(path, cached.content, depth)
        return
      }
      if (result.files.length >= maxFiles) {
        edge(from, path, 'file-limit')
        return
      }
      if (stat.size > maxBytes - bytes) {
        edge(from, path, 'byte-limit')
        return
      }
      const buffer = Buffer.alloc(stat.size + 1)
      let length = 0
      while (length < buffer.length) {
        const count = readSync(fd, buffer, length, buffer.length - length, null)
        if (count === 0) break
        length += count
      }
      if (length > stat.size || length > maxBytes - bytes) {
        edge(from, path, 'byte-limit')
        return
      }
      const content = buffer.subarray(0, length).toString('utf8')
      bytes += length
      const file = { path, identity, content, bytes: length }
      seen.set(identity, file)
      result.files.push(file)
      edge(from, path, 'included')
      expand(path, content, depth)
    } catch {
      edge(from, candidate, 'unavailable')
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }
  // Breadth first: physical files are first reached with the largest remaining depth.
  for (const entry of entries) enqueue(entry, maxDepth)
  for (const { candidate, depth, from } of queue) visit(candidate, depth, from)
  if (truncated || result.edges.length >= 4096) edge(undefined, '', 'edge-limit')
  return result
}
