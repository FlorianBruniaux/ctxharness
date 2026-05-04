import type { RunResult, AssertionResult } from './runner.js'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SnapshotEntry = {
  id: string
  status: AssertionResult['status']
  expected: string | null
  fileCount: number
}

export type Snapshot = {
  version: 1
  timestamp: string
  root: string
  score: number
  grade: string
  totalPass: number
  totalFail: number
  totalWarn: number
  totalError: number
  totalSkip: number
  assertions: SnapshotEntry[]
}

export type DiffEntry = {
  id: string
  before: AssertionResult['status'] | 'no-mention'
  after: AssertionResult['status'] | 'no-mention'
  changed: boolean
}

export type SnapshotDiff = {
  scoresBefore: number
  scoresAfter: number
  scoreDelta: number
  gradeBefore: string
  gradeAfter: string
  changed: DiffEntry[]
  unchanged: DiffEntry[]
}

// ─── Functions ────────────────────────────────────────────────────────────────

export function buildSnapshot(
  result: RunResult,
  score: number,
  grade: string,
  root: string,
): Snapshot {
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    root,
    score,
    grade,
    totalPass: result.totalPass,
    totalFail: result.totalFail,
    totalWarn: result.totalWarn,
    totalError: result.totalError,
    totalSkip: result.totalSkip,
    assertions: result.assertions.map((a) => ({
      id: a.id,
      status: a.status,
      expected: a.expected,
      fileCount: a.results.length,
    })),
  }
}

export function saveSnapshot(snapshot: Snapshot, root: string): string {
  const dir = resolve(root, '.ctxharness', 'snapshots')
  mkdirSync(dir, { recursive: true })
  const ts = snapshot.timestamp.replace(/[:.]/g, '-')
  const filePath = join(dir, `${ts}.json`)
  writeFileSync(filePath, JSON.stringify(snapshot, null, 2))
  return filePath
}

export function loadSnapshot(filePath: string): Snapshot {
  const raw = readFileSync(filePath, 'utf-8')
  return JSON.parse(raw) as Snapshot
}

export function findLatestSnapshot(root: string): string | null {
  const dir = resolve(root, '.ctxharness', 'snapshots')
  if (!existsSync(dir)) return null
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
  return files.length > 0 ? join(dir, files[files.length - 1]!) : null
}

export function diffSnapshots(baseline: Snapshot, current: Snapshot): SnapshotDiff {
  const baseMap = new Map(baseline.assertions.map((a) => [a.id, a]))
  const currMap = new Map(current.assertions.map((a) => [a.id, a]))

  const allIds = new Set([...baseMap.keys(), ...currMap.keys()])
  const changed: DiffEntry[] = []
  const unchanged: DiffEntry[] = []

  for (const id of allIds) {
    const before = baseMap.get(id)?.status ?? 'no-mention'
    const after = currMap.get(id)?.status ?? 'no-mention'
    const entry: DiffEntry = { id, before, after, changed: before !== after }
    if (entry.changed) changed.push(entry)
    else unchanged.push(entry)
  }

  return {
    scoresBefore: baseline.score,
    scoresAfter: current.score,
    scoreDelta: current.score - baseline.score,
    gradeBefore: baseline.grade,
    gradeAfter: current.grade,
    changed,
    unchanged,
  }
}
