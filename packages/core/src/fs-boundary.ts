import { closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export type ReadReason = 'outside-boundary' | 'unavailable' | 'unsupported-reference' | 'file-limit' | 'byte-limit' | 'depth-limit' | 'edge-limit'
export interface ReadPolicy {
  readonly allowedRoots: readonly string[]
  readonly maxFiles?: number
  readonly maxBytes?: number
  readonly maxDepth?: number
}
export interface ContextFile { path: string; identity: string; content: string; bytes: number }
export interface ImportEdge { from?: string; to: string; status: 'included' | 'duplicate' | ReadReason }
export interface ContextRead { files: ContextFile[]; edges: ImportEdge[]; complete: boolean }

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
export function readContext(entries: readonly string[], policy: ReadPolicy, followImports = true): ContextRead {
  const roots = policy.allowedRoots.flatMap((root) => { try { return [realpathSync(root)] } catch { return [] } })
  const cap = (n: number | undefined, fallback: number) => n === undefined || !Number.isFinite(n) ? fallback : Math.max(0, Math.min(Math.floor(n), fallback))
  const maxFiles = cap(policy.maxFiles, 256)
  const maxBytes = cap(policy.maxBytes, 4 * 1024 * 1024)
  const maxDepth = cap(policy.maxDepth, 32)
  const result: ContextRead = { files: [], edges: [], complete: true }
  const seen = new Set<string>()
  let bytes = 0
  const edge = (from: string | undefined, to: string, status: ImportEdge['status']) => {
    if (result.edges.length >= 4096 && status !== 'edge-limit') { result.complete = false; return }
    result.edges.push({ ...(from === undefined ? {} : { from }), to, status })
    if (status !== 'included' && status !== 'duplicate') result.complete = false
  }
  const visit = (candidate: string, depth: number, from?: string): void => {
    if (result.edges.length >= 4096) { result.complete = false; return }
    let path: string
    try { path = realpathSync(candidate) } catch { edge(from, candidate, 'unavailable'); return }
    if (!roots.some((root) => withinRoot(root, path))) { edge(from, candidate, 'outside-boundary'); return }
    let fd: number | undefined
    try {
      fd = openSync(path, 'r')
      const stat = fstatSync(fd)
      if (!stat.isFile()) { edge(from, candidate, 'unavailable'); return }
      const identity = `${stat.dev}:${stat.ino}`
      if (seen.has(identity)) { edge(from, path, 'duplicate'); return }
      if (depth <= 0) { edge(from, path, 'depth-limit'); return }
      if (result.files.length >= maxFiles) { edge(from, path, 'file-limit'); return }
      if (stat.size > maxBytes - bytes) { edge(from, path, 'byte-limit'); return }
      const buffer = Buffer.alloc(stat.size + 1)
      let length = 0
      while (length < buffer.length) {
        const count = readSync(fd, buffer, length, buffer.length - length, null)
        if (count === 0) break
        length += count
      }
      if (length > stat.size || length > maxBytes - bytes) { edge(from, path, 'byte-limit'); return }
      const content = buffer.subarray(0, length).toString('utf8')
      seen.add(identity)
      bytes += length
      result.files.push({ path, identity, content, bytes: length })
      edge(from, path, 'included')
      if (followImports) for (const ref of contextReferences(content)) {
        if (!ref.supported) edge(path, ref.reference, 'unsupported-reference')
        else visit(resolve(dirname(path), ref.reference), depth - 1, path)
      }
    } catch { edge(from, candidate, 'unavailable') }
    finally { if (fd !== undefined) closeSync(fd) }
  }
  for (const entry of entries) visit(entry, maxDepth)
  if (result.edges.length >= 4096) edge(undefined, '', 'edge-limit')
  return result
}
