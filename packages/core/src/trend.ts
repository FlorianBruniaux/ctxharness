import { mkdirSync, appendFileSync, readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrendRecord {
  timestamp: string
  root: string
  projectName: string
  score: number
  grade: string
  totalPass: number
  totalFail: number
  totalWarn: number
  totalError: number
  totalSkip: number
  assertionCount: number
  durationMs: number
}

export interface TrendSummary {
  count: number
  avgScore: number
  direction: 'improving' | 'worsening' | 'flat'
  scoreDelta: number
  sparkline: string
  latest: TrendRecord
  oldest: TrendRecord
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const SPARK_CHARS = '▁▂▃▄▅▆▇█'

function historyDir(): string {
  const override = process.env['CTXHARNESS_HISTORY_DIR']
  return override && override.length > 0 ? override : join(homedir(), '.ctxharness')
}

function historyPath(): string {
  return join(historyDir(), 'history.jsonl')
}

function avgOf(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function appendTrendRecord(record: TrendRecord): void {
  try {
    mkdirSync(historyDir(), { recursive: true })
    appendFileSync(historyPath(), JSON.stringify(record) + '\n', 'utf-8')
  } catch {
    // best-effort — never throw
  }
}

function isTrendRecord(v: unknown): v is TrendRecord {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o['timestamp'] === 'string' &&
    typeof o['score'] === 'number' &&
    typeof o['projectName'] === 'string' &&
    typeof o['root'] === 'string' &&
    typeof o['grade'] === 'string' &&
    typeof o['totalPass'] === 'number' &&
    typeof o['totalFail'] === 'number' &&
    typeof o['totalWarn'] === 'number' &&
    typeof o['totalError'] === 'number' &&
    typeof o['totalSkip'] === 'number' &&
    typeof o['assertionCount'] === 'number' &&
    typeof o['durationMs'] === 'number'
  )
}

export function loadTrendHistory(projectName?: string, limit = 50): TrendRecord[] {
  const path = historyPath()
  if (!existsSync(path)) return []

  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch {
    return []
  }

  const records: TrendRecord[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (!isTrendRecord(parsed)) continue
      if (projectName === undefined || parsed.projectName === projectName) {
        records.push(parsed)
      }
    } catch {
      // skip corrupt lines
    }
  }

  records.sort((a, b) => (a.timestamp > b.timestamp ? -1 : a.timestamp < b.timestamp ? 1 : 0))

  return records.slice(0, limit)
}

/** Summarizes a newest-first array of TrendRecords (as returned by loadTrendHistory). */
export function summarizeTrend(records: TrendRecord[]): TrendSummary | null {
  if (records.length === 0) return null

  // Input is newest-first; reverse to get chronological order
  const chrono = [...records].reverse()

  const scores = chrono.map((r) => r.score)
  const avgScore = Math.round(avgOf(scores))

  const third = Math.max(1, Math.floor(chrono.length / 3))
  const firstThird = scores.slice(0, third)
  const lastThird = scores.slice(chrono.length - third)
  const rawDelta = avgOf(lastThird) - avgOf(firstThird)
  const scoreDelta = Math.round(rawDelta)

  let direction: TrendSummary['direction']
  if (scoreDelta > 3) direction = 'improving'
  else if (scoreDelta < -3) direction = 'worsening'
  else direction = 'flat'

  const minScore = Math.min(...scores)
  const maxScore = Math.max(...scores)
  const range = maxScore - minScore

  const sparkline = chrono
    .map((r) => {
      if (range === 0) return SPARK_CHARS[0]!
      const idx = Math.min(7, Math.floor(((r.score - minScore) / range) * 8))
      return SPARK_CHARS[idx]!
    })
    .join('')

  return {
    count: records.length,
    avgScore,
    direction,
    scoreDelta,
    sparkline,
    latest: records[0]!,
    oldest: chrono[0]!,
  }
}

