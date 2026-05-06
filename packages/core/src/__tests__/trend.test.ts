import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendTrendRecord,
  loadTrendHistory,
  summarizeTrend,
} from '../trend.js'
import type { TrendRecord } from '../trend.js'

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ctxharness-trend-test-'))
}

function makeRecord(overrides: Partial<TrendRecord> = {}): TrendRecord {
  return {
    timestamp: new Date().toISOString(),
    root: '/projects/myapp',
    projectName: 'myapp',
    score: 75,
    grade: 'B',
    totalPass: 10,
    totalFail: 2,
    totalWarn: 1,
    totalError: 0,
    totalSkip: 0,
    assertionCount: 13,
    durationMs: 120,
    ...overrides,
  }
}

let tempDir: string

beforeEach(() => {
  tempDir = makeTempDir()
  process.env['CTXHARNESS_HISTORY_DIR'] = tempDir
})

afterEach(() => {
  delete process.env['CTXHARNESS_HISTORY_DIR']
})

// ─── appendTrendRecord ────────────────────────────────────────────────────────

describe('appendTrendRecord', () => {
  it('creates history.jsonl if it does not exist', () => {
    const record = makeRecord()
    appendTrendRecord(record)

    const filePath = join(tempDir, 'history.jsonl')
    const content = readFileSync(filePath, 'utf-8')
    expect(content.trim().length).toBeGreaterThan(0)
  })

  it('appends one line per call (2 calls → 2 lines)', () => {
    appendTrendRecord(makeRecord({ score: 80 }))
    appendTrendRecord(makeRecord({ score: 90 }))

    const filePath = join(tempDir, 'history.jsonl')
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(2)
  })

  it('each line is valid JSON with correct fields', () => {
    const record = makeRecord({ score: 66, grade: 'C', projectName: 'myapp' })
    appendTrendRecord(record)

    const filePath = join(tempDir, 'history.jsonl')
    const line = readFileSync(filePath, 'utf-8').trim()
    const parsed = JSON.parse(line) as TrendRecord
    expect(parsed.score).toBe(66)
    expect(parsed.grade).toBe('C')
    expect(parsed.projectName).toBe('myapp')
    expect(typeof parsed.timestamp).toBe('string')
  })

  it('silently ignores write errors (no throw on bad path)', () => {
    const original = process.env['CTXHARNESS_HISTORY_DIR']
    try {
      process.env['CTXHARNESS_HISTORY_DIR'] = '/nonexistent/path/xyz/abc'
      expect(() => appendTrendRecord(makeRecord())).not.toThrow()
    } finally {
      if (original !== undefined) {
        process.env['CTXHARNESS_HISTORY_DIR'] = original
      } else {
        delete process.env['CTXHARNESS_HISTORY_DIR']
      }
    }
  })
})

// ─── loadTrendHistory ─────────────────────────────────────────────────────────

describe('loadTrendHistory', () => {
  it('returns [] when history.jsonl does not exist', () => {
    const result = loadTrendHistory()
    expect(result).toEqual([])
  })

  it('returns records sorted newest-first', () => {
    const older = makeRecord({ timestamp: '2026-01-01T00:00:00.000Z', score: 50 })
    const newer = makeRecord({ timestamp: '2026-06-01T00:00:00.000Z', score: 90 })
    appendTrendRecord(older)
    appendTrendRecord(newer)

    const records = loadTrendHistory()
    expect(records).toHaveLength(2)
    expect(records[0]!.score).toBe(90)
    expect(records[1]!.score).toBe(50)
  })

  it('filters by projectName when provided', () => {
    appendTrendRecord(makeRecord({ projectName: 'alpha' }))
    appendTrendRecord(makeRecord({ projectName: 'beta' }))
    appendTrendRecord(makeRecord({ projectName: 'alpha' }))

    const result = loadTrendHistory('alpha')
    expect(result).toHaveLength(2)
    expect(result.every((r) => r.projectName === 'alpha')).toBe(true)
  })

  it('respects limit and returns newest records first', () => {
    // Insert 10 records with distinct timestamps (day 0 = oldest, day 9 = newest)
    for (let i = 0; i < 10; i++) {
      const ts = new Date(Date.UTC(2026, 0, 1 + i)).toISOString()
      appendTrendRecord(makeRecord({ score: 50 + i, timestamp: ts }))
    }

    const result = loadTrendHistory(undefined, 3)
    expect(result).toHaveLength(3)
    // Should be the 3 newest: day 9, 8, 7 → scores 59, 58, 57
    expect(result[0]!.score).toBe(59)
    expect(result[1]!.score).toBe(58)
    expect(result[2]!.score).toBe(57)
  })

  it('skips corrupt lines without throwing', () => {
    const filePath = join(tempDir, 'history.jsonl')
    writeFileSync(filePath, 'not-json\n')
    appendTrendRecord(makeRecord({ score: 77 }))

    const result = loadTrendHistory()
    expect(result).toHaveLength(1)
    expect(result[0]!.score).toBe(77)
  })
})

// ─── summarizeTrend ───────────────────────────────────────────────────────────

describe('summarizeTrend', () => {
  it('returns null for empty array', () => {
    expect(summarizeTrend([])).toBeNull()
  })

  it('computes avgScore correctly', () => {
    const records = [
      makeRecord({ score: 90, timestamp: '2026-03-01T00:00:00.000Z' }),
      makeRecord({ score: 60, timestamp: '2026-02-01T00:00:00.000Z' }),
      makeRecord({ score: 75, timestamp: '2026-01-01T00:00:00.000Z' }),
    ]
    const summary = summarizeTrend(records)
    expect(summary).not.toBeNull()
    expect(summary!.avgScore).toBe(75)
  })

  it("direction='improving' when last-third avg > first-third avg by >3 pts", () => {
    // chronological: 50, 55, 60, 80, 85, 90
    // newest-first: 90, 85, 80, 60, 55, 50
    const records = [
      makeRecord({ score: 90, timestamp: '2026-06-01T00:00:00.000Z' }),
      makeRecord({ score: 85, timestamp: '2026-05-01T00:00:00.000Z' }),
      makeRecord({ score: 80, timestamp: '2026-04-01T00:00:00.000Z' }),
      makeRecord({ score: 60, timestamp: '2026-03-01T00:00:00.000Z' }),
      makeRecord({ score: 55, timestamp: '2026-02-01T00:00:00.000Z' }),
      makeRecord({ score: 50, timestamp: '2026-01-01T00:00:00.000Z' }),
    ]
    const summary = summarizeTrend(records)
    expect(summary!.direction).toBe('improving')
    expect(summary!.scoreDelta).toBeGreaterThan(3)
  })

  it("direction='worsening' when first-third avg > last-third avg by >3 pts", () => {
    // chronological: 90, 85, 80, 60, 55, 50
    // newest-first: 50, 55, 60, 80, 85, 90
    const records = [
      makeRecord({ score: 50, timestamp: '2026-06-01T00:00:00.000Z' }),
      makeRecord({ score: 55, timestamp: '2026-05-01T00:00:00.000Z' }),
      makeRecord({ score: 60, timestamp: '2026-04-01T00:00:00.000Z' }),
      makeRecord({ score: 80, timestamp: '2026-03-01T00:00:00.000Z' }),
      makeRecord({ score: 85, timestamp: '2026-02-01T00:00:00.000Z' }),
      makeRecord({ score: 90, timestamp: '2026-01-01T00:00:00.000Z' }),
    ]
    const summary = summarizeTrend(records)
    expect(summary!.direction).toBe('worsening')
    expect(summary!.scoreDelta).toBeLessThan(-3)
  })

  it("direction='flat' when delta ≤ 3", () => {
    const records = [
      makeRecord({ score: 75, timestamp: '2026-03-01T00:00:00.000Z' }),
      makeRecord({ score: 74, timestamp: '2026-02-01T00:00:00.000Z' }),
      makeRecord({ score: 76, timestamp: '2026-01-01T00:00:00.000Z' }),
    ]
    const summary = summarizeTrend(records)
    expect(summary!.direction).toBe('flat')
  })

  it('sparkline has one char per record', () => {
    const records = [
      makeRecord({ score: 90, timestamp: '2026-03-01T00:00:00.000Z' }),
      makeRecord({ score: 70, timestamp: '2026-02-01T00:00:00.000Z' }),
      makeRecord({ score: 50, timestamp: '2026-01-01T00:00:00.000Z' }),
    ]
    const summary = summarizeTrend(records)
    expect(summary!.sparkline).toHaveLength(3)
  })

  it("sparkline uses '█' for max score and '▁' for min when range > 0", () => {
    // chronological order: 50 (min), 70, 90 (max)
    // newest-first input: 90, 70, 50
    const records = [
      makeRecord({ score: 90, timestamp: '2026-03-01T00:00:00.000Z' }),
      makeRecord({ score: 70, timestamp: '2026-02-01T00:00:00.000Z' }),
      makeRecord({ score: 50, timestamp: '2026-01-01T00:00:00.000Z' }),
    ]
    const summary = summarizeTrend(records)
    // sparkline is chronological: ▁?█
    expect(summary!.sparkline[0]).toBe('▁')
    expect(summary!.sparkline[2]).toBe('█')
  })

  it("latest is records[0] (newest in newest-first input)", () => {
    const newest = makeRecord({ score: 99, timestamp: '2026-06-01T00:00:00.000Z' })
    const older = makeRecord({ score: 40, timestamp: '2026-01-01T00:00:00.000Z' })
    const records = [newest, older]
    const summary = summarizeTrend(records)
    expect(summary!.latest.score).toBe(99)
    expect(summary!.oldest.score).toBe(40)
  })
})
