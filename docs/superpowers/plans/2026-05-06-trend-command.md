# Trend Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cross-run drift score history — auto-record every `run`/`check`/`score` to `~/.ctxharness/history.jsonl` and expose a `trend` command showing sparkline, direction, and per-run table.

**Architecture:** New `packages/core/src/trend.ts` exports `appendTrendRecord`, `loadTrendHistory`, `summarizeTrend`. The CLI calls `appendTrendRecord` after each non-watch run. The new `trend` command reads history and renders a sparkline + table. History path is overridable via `CTXHARNESS_HISTORY_DIR` env var (testability + CI isolation).

**Tech Stack:** Node.js fs (sync), vitest, chalk, existing commander pattern.

---

## Scope note

This plan covers **trend only**. The other 4 features from the CRUSTS analysis (auto-inject hook, HTML report, shell completion, ranked fix --apply) are independent and should be planned separately.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/core/src/trend.ts` | TrendRecord type, appendTrendRecord, loadTrendHistory, summarizeTrend, sparkline |
| Modify | `packages/core/src/index.ts` | Export trend functions and TrendRecord type |
| Create | `packages/core/src/__tests__/trend.test.ts` | Unit tests — no mocks, uses CTXHARNESS_HISTORY_DIR env override |
| Modify | `packages/cli/src/index.ts` | Import appendTrendRecord; call it after non-watch runs; add `trend` command |

---

## Task 1: Core trend module

**Files:**
- Create: `packages/core/src/trend.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/__tests__/trend.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { appendTrendRecord, loadTrendHistory, summarizeTrend } from '../trend.js'
import type { TrendRecord } from '../trend.js'

const TMP = join(tmpdir(), `ctxharness-trend-test-${process.pid}`)

function makeRecord(score: number, offsetDays = 0): TrendRecord {
  const d = new Date(2026, 0, 1 + offsetDays)
  return {
    timestamp: d.toISOString(),
    root: '/fake/project',
    projectName: 'project',
    score,
    grade: score >= 90 ? 'A' : score >= 75 ? 'B' : 'C',
    totalPass: Math.round(score / 20),
    totalFail: score < 100 ? 1 : 0,
    totalWarn: 0,
    totalError: 0,
    totalSkip: 0,
    assertionCount: 5,
    durationMs: 42,
  }
}

beforeEach(() => {
  mkdirSync(TMP, { recursive: true })
  process.env['CTXHARNESS_HISTORY_DIR'] = TMP
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  delete process.env['CTXHARNESS_HISTORY_DIR']
})

describe('appendTrendRecord', () => {
  it('creates history.jsonl if it does not exist', () => {
    appendTrendRecord(makeRecord(80))
    expect(existsSync(join(TMP, 'history.jsonl'))).toBe(true)
  })

  it('appends one line per call', () => {
    appendTrendRecord(makeRecord(80))
    appendTrendRecord(makeRecord(90))
    const lines = readFileSync(join(TMP, 'history.jsonl'), 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(2)
  })

  it('each line is valid JSON with required fields', () => {
    appendTrendRecord(makeRecord(75))
    const line = readFileSync(join(TMP, 'history.jsonl'), 'utf-8').trim()
    const parsed = JSON.parse(line) as TrendRecord
    expect(parsed.score).toBe(75)
    expect(parsed.projectName).toBe('project')
    expect(typeof parsed.timestamp).toBe('string')
  })

  it('silently ignores write errors (non-existent dir without env override)', () => {
    process.env['CTXHARNESS_HISTORY_DIR'] = '/nonexistent/path/that/cannot/be/created/xyz'
    expect(() => appendTrendRecord(makeRecord(80))).not.toThrow()
  })
})

describe('loadTrendHistory', () => {
  it('returns empty array when history file does not exist', () => {
    expect(loadTrendHistory()).toEqual([])
  })

  it('returns records sorted newest-first', () => {
    appendTrendRecord(makeRecord(70, 0))
    appendTrendRecord(makeRecord(80, 1))
    appendTrendRecord(makeRecord(90, 2))
    const records = loadTrendHistory()
    expect(records[0]!.score).toBe(90)
    expect(records[2]!.score).toBe(70)
  })

  it('filters by projectName', () => {
    const r1: TrendRecord = { ...makeRecord(80), projectName: 'alpha' }
    const r2: TrendRecord = { ...makeRecord(90), projectName: 'beta' }
    appendTrendRecord(r1)
    appendTrendRecord(r2)
    const records = loadTrendHistory('alpha')
    expect(records).toHaveLength(1)
    expect(records[0]!.projectName).toBe('alpha')
  })

  it('respects limit', () => {
    for (let i = 0; i < 10; i++) appendTrendRecord(makeRecord(50 + i, i))
    const records = loadTrendHistory(undefined, 3)
    expect(records).toHaveLength(3)
  })

  it('skips corrupt lines without throwing', () => {
    const { appendFileSync } = await import('node:fs')
    appendFileSync(join(TMP, 'history.jsonl'), 'not-json\n')
    appendTrendRecord(makeRecord(80))
    const records = loadTrendHistory()
    expect(records).toHaveLength(1)
  })
})

describe('summarizeTrend', () => {
  it('returns null for empty array', () => {
    expect(summarizeTrend([])).toBeNull()
  })

  it('computes avgScore correctly', () => {
    const records = [makeRecord(80), makeRecord(60), makeRecord(100)]
    const summary = summarizeTrend(records)!
    expect(summary.avgScore).toBe(80)
  })

  it('direction is improving when last third avg > first third avg by more than 3', () => {
    // oldest first: 50, 55, 60, 80, 85, 90
    const records = [90, 85, 80, 60, 55, 50].map((s, i) => makeRecord(s, 5 - i))
    // loadTrendHistory returns newest-first, so we simulate that
    const summary = summarizeTrend(records)!
    expect(summary.direction).toBe('improving')
    expect(summary.scoreDelta).toBeGreaterThan(3)
  })

  it('direction is worsening when last third avg < first third avg by more than 3', () => {
    const records = [50, 55, 60, 80, 85, 90].map((s, i) => makeRecord(s, 5 - i))
    const summary = summarizeTrend(records)!
    expect(summary.direction).toBe('worsening')
  })

  it('direction is flat when delta is within ±3', () => {
    const records = [80, 82, 79, 81, 80, 83].map((s, i) => makeRecord(s, 5 - i))
    const summary = summarizeTrend(records)!
    expect(summary.direction).toBe('flat')
  })

  it('sparkline has one char per record', () => {
    const records = [80, 90, 70].map((s, i) => makeRecord(s, 2 - i))
    const summary = summarizeTrend(records)!
    expect([...summary.sparkline]).toHaveLength(3)
  })

  it('sparkline uses block chars', () => {
    const records = [100, 0].map((s, i) => makeRecord(s, 1 - i))
    const summary = summarizeTrend(records)!
    expect(summary.sparkline).toContain('█')
    expect(summary.sparkline).toContain('▁')
  })

  it('latest is the newest record (index 0 in newest-first array)', () => {
    const records = [makeRecord(90, 1), makeRecord(70, 0)]
    const summary = summarizeTrend(records)!
    expect(summary.latest.score).toBe(90)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm vitest run packages/core/src/__tests__/trend.test.ts
```

Expected: `Cannot find module '../trend.js'` or similar.

- [ ] **Step 3: Implement `packages/core/src/trend.ts`**

```typescript
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs'

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

const SPARKLINE = '▁▂▃▄▅▆▇█'

function historyDir(): string {
  const override = process.env['CTXHARNESS_HISTORY_DIR']
  return override && override.length > 0 ? override : join(homedir(), '.ctxharness')
}

function historyPath(): string {
  return join(historyDir(), 'history.jsonl')
}

export function appendTrendRecord(record: TrendRecord): void {
  try {
    const dir = historyDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(historyPath(), JSON.stringify(record) + '\n', 'utf-8')
  } catch {
    // best-effort — never throw from recording
  }
}

export function loadTrendHistory(projectName?: string, limit = 50): TrendRecord[] {
  const path = historyPath()
  if (!existsSync(path)) return []

  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
  const records: TrendRecord[] = []

  for (const line of lines) {
    try {
      const record = JSON.parse(line) as TrendRecord
      if (projectName !== undefined && record.projectName !== projectName) continue
      records.push(record)
    } catch {
      // skip corrupt lines
    }
  }

  records.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  return records.slice(0, limit)
}

export function summarizeTrend(records: TrendRecord[]): TrendSummary | null {
  if (records.length === 0) return null

  // records are newest-first — reverse for chronological order
  const chrono = [...records].reverse()

  const avgScore = Math.round(chrono.reduce((s, r) => s + r.score, 0) / chrono.length)

  const third = Math.max(1, Math.floor(chrono.length / 3))
  const avgFirst = chrono.slice(0, third).reduce((s, r) => s + r.score, 0) / third
  const avgLast = chrono.slice(-third).reduce((s, r) => s + r.score, 0) / third
  const scoreDelta = Math.round(avgLast - avgFirst)

  const direction: TrendSummary['direction'] =
    scoreDelta > 3 ? 'improving' : scoreDelta < -3 ? 'worsening' : 'flat'

  const scores = chrono.map((r) => r.score)
  const min = Math.min(...scores)
  const max = Math.max(...scores)
  const range = max - min || 1
  const sparkline = scores
    .map((s) => {
      const idx = Math.min(7, Math.floor(((s - min) / range) * 8))
      return SPARKLINE[idx] ?? '▁'
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm vitest run packages/core/src/__tests__/trend.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/trend.ts packages/core/src/__tests__/trend.test.ts
git commit -m "feat(core): add trend module — TrendRecord, appendTrendRecord, loadTrendHistory, summarizeTrend"
```

---

## Task 2: Export from core package

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add exports**

In `packages/core/src/index.ts`, append at the end:

```typescript
export { appendTrendRecord, loadTrendHistory, summarizeTrend } from './trend.js'
export type { TrendRecord, TrendSummary } from './trend.js'
```

- [ ] **Step 2: Build core to confirm no type errors**

```bash
pnpm -F @florianbruniaux/ctxharness-core build
```

Expected: clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export trend functions from public API"
```

---

## Task 3: Auto-record after `run`, `check`, `score`

**Files:**
- Modify: `packages/cli/src/index.ts`

The `run` command already has a `doRun` function. We want to record after a non-watch `run`. The `check` and `score` commands call `run()` directly. None of them call `computeScore` except `score` and `doctor`.

- [ ] **Step 1: Add import at the top of `packages/cli/src/index.ts`**

After the existing imports (around line 6), add:

```typescript
import { appendTrendRecord } from '@florianbruniaux/ctxharness-core'
import type { TrendRecord } from '@florianbruniaux/ctxharness-core'
import { basename } from 'node:path'
```

Note: `basename` may already be imported — check line 3 and extend the existing `import { resolve, join } from 'node:path'` to `import { resolve, join, basename } from 'node:path'` if needed.

- [ ] **Step 2: Add a helper to record a run result**

After the `computeScore` function (around line 32), add:

```typescript
function recordTrend(result: RunResult, root: string, opts: { noTrend?: boolean }): void {
  if (opts.noTrend === true) return
  const { score, grade } = computeScore(result.assertions)
  appendTrendRecord({
    timestamp: new Date().toISOString(),
    root,
    projectName: basename(root),
    score,
    grade,
    totalPass: result.totalPass,
    totalFail: result.totalFail,
    totalWarn: result.totalWarn,
    totalError: result.totalError,
    totalSkip: result.totalSkip,
    assertionCount: result.assertions.length,
    durationMs: result.durationMs,
  })
}
```

- [ ] **Step 3: Add `--no-trend` flag to `run` command and call recordTrend**

In the `run` command (around line 44), add the option and call:

```typescript
program
  .command('run')
  .description('Run all assertions and report results')
  .option('-c, --config <path>', 'Path to config file', '.ctxharness.yml')
  .option('-f, --format <fmt>', 'Output format: text | json | gha', 'text')
  .option('-r, --root <dir>', 'Project root directory', '')
  .option('-w, --watch', 'Re-run on file changes (fs.watch, recursive)')
  .option('--no-trend', 'Skip recording this run to trend history')
  .action(async (opts: { config: string; format: string; root: string; watch?: boolean; trend: boolean }) => {
```

Note: Commander inverts `--no-X` flags — `--no-trend` sets `opts.trend = false`. The default is `true`.

Then in the non-watch path, before `process.exit`:

```typescript
      const result = await doRun()
      if (opts.watch !== true) recordTrend(result, root, { noTrend: opts.trend === false })
      process.exit(result.totalFail > 0 || result.totalError > 0 ? 1 : 0)
```

- [ ] **Step 4: Add `--no-trend` to `check` and record**

In the `check` command (around line 106), add:

```typescript
program
  .command('check')
  .description('Run assertions with text output (alias for run --format text)')
  .option('-c, --config <path>', 'Path to config file', '.ctxharness.yml')
  .option('-r, --root <dir>', 'Project root directory', '')
  .option('--no-trend', 'Skip recording this run to trend history')
  .action(async (opts: { config: string; root: string; trend: boolean }) => {
```

Before `process.exit` in `check`:

```typescript
      recordTrend(result, root, { noTrend: opts.trend === false })
      process.exit(result.totalFail > 0 || result.totalError > 0 ? 1 : 0)
```

- [ ] **Step 5: Add `--no-trend` to `score` and record**

Same pattern in the `score` command (around line 138):

```typescript
program
  .command('score')
  .description('Run assertions and report a 0-100 context health score')
  .option('-c, --config <path>', 'Path to config file', '.ctxharness.yml')
  .option('-r, --root <dir>', 'Project root directory', '')
  .option('--no-trend', 'Skip recording this run to trend history')
  .action(async (opts: { config: string; root: string; trend: boolean }) => {
```

Before `process.exit` in `score` (the score command already calls `computeScore` — use the existing `score`/`grade` values):

```typescript
      appendTrendRecord({
        timestamp: new Date().toISOString(),
        root,
        projectName: basename(root),
        score,
        grade,
        totalPass: result.totalPass,
        totalFail: result.totalFail,
        totalWarn: result.totalWarn,
        totalError: result.totalError,
        totalSkip: result.totalSkip,
        assertionCount: result.assertions.length,
        durationMs: result.durationMs,
      } satisfies TrendRecord)
      if (opts.trend !== false) recordTrend(result, root, {})
```

Wait — in `score`, `computeScore` is already called and `score`/`grade` are in scope. Use `recordTrend` directly:

```typescript
      if (opts.trend !== false) recordTrend(result, root, {})
      process.exit(result.totalFail > 0 || result.totalError > 0 ? 1 : 0)
```

- [ ] **Step 6: Build CLI and verify no type errors**

```bash
pnpm lint
```

Expected: no errors.

- [ ] **Step 7: Manual smoke test**

```bash
pnpm build && node packages/cli/dist/index.js run -c .ctxharness.yml
ls ~/.ctxharness/history.jsonl
cat ~/.ctxharness/history.jsonl | tail -1
```

Expected: the file exists and the last line is a valid JSON object with `score`, `projectName: "ctxharness"`, etc.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): auto-record run/check/score results to ~/.ctxharness/history.jsonl"
```

---

## Task 4: `trend` command

**Files:**
- Modify: `packages/cli/src/index.ts` (add `trend` command at the end, before `program.parse()`)

- [ ] **Step 1: Add the trend command**

At the end of `packages/cli/src/index.ts`, before `program.parse()`, add:

```typescript
// ─── trend command ────────────────────────────────────────────────────────────

program
  .command('trend')
  .description('Show cross-run drift score history and direction')
  .option('-p, --project <name>', 'Filter by project name (default: current directory name)')
  .option('-n, --limit <n>', 'Max runs to show (default: 20)', '20')
  .option('--all', 'Show all projects')
  .action(async (opts: { project?: string; limit: string; all?: boolean }) => {
    try {
      const { default: chalk } = await import('chalk')
      const { loadTrendHistory, summarizeTrend } = await import('@florianbruniaux/ctxharness-core')

      const limit = Math.max(1, parseInt(opts.limit, 10) || 20)
      const projectName = opts.all === true ? undefined : (opts.project ?? basename(process.cwd()))

      const records = loadTrendHistory(projectName, limit)

      if (records.length === 0) {
        console.log(chalk.dim(`\nNo trend history for "${projectName ?? 'any project'}".`))
        console.log(chalk.dim('Run ctxharness run to start tracking.\n'))
        process.exit(0)
      }

      const summary = summarizeTrend(records)!

      const projectLabel = opts.all === true ? 'all projects' : (projectName ?? 'unknown')
      console.log(chalk.bold(`\nTrend — ${projectLabel} (${records.length} run${records.length !== 1 ? 's' : ''})\n`))

      const dirColor =
        summary.direction === 'improving' ? 'green' :
        summary.direction === 'worsening' ? 'red' : 'yellow'
      const dirSymbol =
        summary.direction === 'improving' ? '↑' :
        summary.direction === 'worsening' ? '↓' : '→'
      const deltaStr = summary.scoreDelta > 0 ? `+${summary.scoreDelta}` : String(summary.scoreDelta)

      console.log(`  ${chalk.dim('Sparkline')}   ${summary.sparkline}`)
      console.log(`  ${chalk.dim('Direction')}   ${chalk[dirColor](`${dirSymbol} ${summary.direction}`)}  ${chalk.dim(`(${deltaStr} pts over ${records.length} runs)`)}`)
      console.log(`  ${chalk.dim('Avg Score')}   ${summary.avgScore}/100`)
      console.log('')

      // Table
      const w = { date: 22, score: 9, grade: 6, pass: 5, fail: 5, time: 8 }
      const pad = (s: string, n: number) => s.padEnd(n)

      console.log(
        chalk.dim(
          `  ${pad('Date', w.date)}  ${pad('Score', w.score)}  ${pad('G', w.grade)}  ` +
          `${pad('Pass', w.pass)}  ${pad('Fail', w.fail)}  Time`
        )
      )
      console.log(chalk.dim(`  ${'─'.repeat(62)}`))

      for (const r of records) {
        const gradeColor =
          r.grade === 'S' || r.grade === 'A' ? 'green' :
          r.grade === 'B' ? 'cyan' :
          r.grade === 'C' ? 'yellow' : 'red'

        const date = new Date(r.timestamp).toLocaleString('en-US', {
          month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        })

        console.log(
          `  ${pad(date, w.date)}  ` +
          `${chalk[gradeColor](pad(`${r.score}/100`, w.score))}  ` +
          `${chalk[gradeColor](pad(r.grade, w.grade))}  ` +
          `${pad(String(r.totalPass), w.pass)}  ` +
          `${pad(String(r.totalFail), w.fail)}  ` +
          chalk.dim(`${Math.round(r.durationMs)}ms`)
        )
      }

      console.log('')
      process.exit(0)
    } catch (e) {
      process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`)
      process.exit(1)
    }
  })
```

- [ ] **Step 2: Build and run**

```bash
pnpm build && node packages/cli/dist/index.js trend
```

Expected output:
```
Trend — ctxharness (N runs)

  Sparkline   ▆▇█████
  Direction   → flat  (0 pts over N runs)
  Avg Score   100/100

  Date                    Score      G      Pass   Fail   Time
  ──────────────────────────────────────────────────────────────
  May 06, 14:23:01       100/100    S      5      0      42ms
  ...
```

- [ ] **Step 3: Test with `--all` and `--project`**

```bash
node packages/cli/dist/index.js trend --all
node packages/cli/dist/index.js trend --project fakename
```

Expected: `--all` shows all records, `--project fakename` shows "No trend history" message.

- [ ] **Step 4: Run full test suite to confirm no regressions**

```bash
pnpm test
```

Expected: all 164+ tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): add trend command — sparkline, direction, per-run table"
```

---

## Task 5: Wire up to `doctor` and add `--trend` mention in `score` output

**Files:**
- Modify: `packages/cli/src/index.ts`

The `doctor` command gives a full picture. It should also record a trend entry so users who only use `doctor` still build history.

- [ ] **Step 1: Add `--no-trend` to `doctor` and call `recordTrend`**

In the `doctor` command (around line 319), extend the option type and add recording before `process.exit`:

```typescript
program
  .command('doctor')
  .description('Comprehensive health check of AI context assembly')
  .option('-c, --config <path>', 'Path to config file', '.ctxharness.yml')
  .option('-r, --root <dir>', 'Project root directory', '')
  .option('--no-trend', 'Skip recording this run to trend history')
  .action(async (opts: { config: string; root: string; trend: boolean }) => {
```

And before the final `process.exit`:

```typescript
      if (opts.trend !== false) recordTrend(result, root, {})
      process.exit(result.totalFail > 0 || result.totalError > 0 ? 1 : 0)
```

- [ ] **Step 2: Add trend hint to `score` command output**

In the `score` command output, after the grade line, add a dim hint pointing to `trend`:

```typescript
      console.log(chalk.dim(`  Run ctxharness trend to see history.\n`))
```

This goes after the existing `console.log('')` at the bottom of the score command.

- [ ] **Step 3: Build + full test suite**

```bash
pnpm build && pnpm test
```

Expected: clean build, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): record trend from doctor; add trend hint in score output"
```

---

## Task 6: Export `TrendRecord` in core + version bump

**Files:**
- Modify: `packages/core/package.json` and `packages/cli/package.json`

The trend feature is additive and backward-compatible. Bump patch version.

- [ ] **Step 1: Bump both package versions**

In `packages/core/package.json`, change `"version"` from `"0.4.2"` to `"0.4.3"`.

In `packages/cli/package.json`, change `"version"` from current to the same patch bump.

In root `package.json` if there is a root version field, bump that too.

- [ ] **Step 2: Update CHANGELOG.md**

Add at the top of `CHANGELOG.md`:

```markdown
## [0.4.3] — 2026-05-06

### Added
- `trend` command — cross-run drift score history with sparkline, direction detection (improving/worsening/flat), and per-run table
- Auto-recording to `~/.ctxharness/history.jsonl` after every `run`, `check`, `score`, and `doctor` run
- `--no-trend` flag on all four commands to skip recording (useful for CI where you want trends only on main branch)
```

- [ ] **Step 3: Final build + tests**

```bash
pnpm build && pnpm test
```

Expected: clean, all tests pass.

- [ ] **Step 4: Final commit**

```bash
git add packages/core/package.json packages/cli/package.json CHANGELOG.md
git commit -m "chore: release v0.4.3 — trend command + cross-run history"
```

---

## Self-Review

**Spec coverage:**
- ✓ `appendTrendRecord` — Task 1
- ✓ `loadTrendHistory` with project filter + limit — Task 1
- ✓ `summarizeTrend` with sparkline + direction — Task 1
- ✓ Auto-record on `run` (non-watch) — Task 3
- ✓ Auto-record on `check` — Task 3
- ✓ Auto-record on `score` — Task 3
- ✓ Auto-record on `doctor` — Task 5
- ✓ `--no-trend` flag — Task 3, 5
- ✓ `trend` command with `--project`, `--limit`, `--all` — Task 4
- ✓ Sparkline rendering — Task 1 (summarizeTrend) + Task 4 (display)
- ✓ CHANGELOG + version bump — Task 6

**Placeholder scan:** No TBD or TODO in the plan.

**Type consistency:**
- `TrendRecord` defined in Task 1, used in Tasks 3 and 4 — consistent field names throughout
- `TrendSummary.sparkline` defined in Task 1, rendered in Task 4 — consistent
- `recordTrend` helper defined in Task 3 and reused in Task 5 — consistent

**Gaps:**
- Watch mode exclusion from recording: addressed in Task 3 (`if (opts.watch !== true)`)
- CTXHARNESS_HISTORY_DIR env override: addressed in Task 1 (`historyDir()` function)

---

## Up Next (separate plans)

These features can be tackled after trend ships:

1. **auto-inject hook** (~2 days) — `UserPromptSubmit` hook in `~/.claude/settings.json` that prepends a drift warning when score < threshold. Needs `ctxharness hooks enable|disable|status` and `ctxharness auto-inject` internal command.

2. **HTML/Markdown report** (~1 day) — `ctxharness report --format html|md` generates a standalone artifact for CI upload. Pure renderer, no new core logic.

3. **Shell completion** (~2h) — `ctxharness completion <bash|zsh|pwsh>` emits a completion script. Covers subcommands and config path completion.
