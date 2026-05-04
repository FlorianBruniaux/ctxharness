import { styleText } from 'node:util'
import type { RunResult } from './runner.js'
import { relative } from 'node:path'

export type OutputFormat = 'text' | 'json' | 'gha'

export function report(result: RunResult, format: OutputFormat = 'text'): void {
  switch (format) {
    case 'text':
      return reportText(result)
    case 'json':
      return reportJson(result)
    case 'gha':
      return reportGha(result)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Whether to emit ANSI color codes in the current environment. */
const useColor: boolean =
  process.env['FORCE_COLOR'] !== undefined ||
  (typeof (process.stdout as { hasColors?: () => boolean }).hasColors === 'function'
    ? (process.stdout as { hasColors: () => boolean }).hasColors()
    : process.stdout.isTTY === true)

function c(color: Parameters<typeof styleText>[0], text: string): string {
  return useColor ? styleText(color, text) : text
}

/** Left-pad a string to a fixed width (truncate with … if over). */
function col(text: string, width: number): string {
  if (text.length > width) return text.slice(0, width - 1) + '…'
  return text.padEnd(width)
}

/** Right-pad a number as string to a fixed width. */
function numCol(n: number | string, width: number): string {
  return String(n).padStart(width)
}

const RULE = '─'.repeat(72)

// ─── Text reporter ────────────────────────────────────────────────────────────

function reportText(result: RunResult): void {
  const { assertions, totalPass, totalWarn, totalSkip, totalError, durationMs } = result

  const totalFiles = new Set(
    assertions.flatMap((a) => a.results.map((r) => r.file)),
  ).size

  console.log(`\nAI Context Test — ${assertions.length} assertion${assertions.length !== 1 ? 's' : ''}\n`)

  // Summary table header
  console.log(
    c('dim', col('fact', 24)) +
    c('dim', col('expected', 14)) +
    c('dim', numCol('mentions', 9)) +
    c('dim', '  status'),
  )
  console.log(c('dim', RULE))

  for (const assertion of assertions) {
    const { id, label, expected, status, results } = assertion
    const displayLabel = label !== id ? label : id
    const expectedStr = expected ?? '(error)'
    const mentionCount = results.filter((r) => r.actual !== '').length

    let statusStr: string
    switch (status) {
      case 'pass':
        statusStr = c('green', `✓ ${mentionCount}/${mentionCount} pass`)
        break
      case 'fail': {
        const failCount = results.filter((r) => r.status === 'fail').length
        statusStr = c('red', `✗ ${failCount} mismatch${failCount !== 1 ? 'es' : ''}`)
        break
      }
      case 'skip': {
        const skipCount = results.filter((r) => r.status === 'skip').length
        statusStr = c('dim', `~ ${skipCount} skipped`)
        break
      }
      case 'warn': {
        const warnCount = results.filter((r) => r.status === 'warn').length
        statusStr = c('yellow', `⚠ ${warnCount} warn`)
        break
      }
      case 'no-mention':
        statusStr = c('yellow', '– no mention')
        break
      case 'error':
        statusStr = c('red', '! error')
        break
    }

    console.log(
      col(displayLabel, 24) +
      col(expectedStr, 14) +
      numCol(mentionCount, 9) +
      '  ' + statusStr,
    )
  }

  console.log(c('dim', RULE))

  // Mismatches detail section
  const failingAssertions = assertions.filter((a) => a.status === 'fail')
  if (failingAssertions.length > 0) {
    console.log('')
    console.log(c('bold', 'Mismatches'))
    console.log(c('dim', RULE))
    console.log(
      c('dim', col('fact', 24)) +
      c('dim', col('file', 42)) +
      c('dim', numCol('line', 6)) +
      c('dim', '  ' + col('expected', 10)) +
      c('dim', '  actual'),
    )

    for (const assertion of failingAssertions) {
      const failResults = assertion.results.filter((r) => r.status === 'fail')
      for (const r of failResults) {
        const relFile = relative(process.cwd(), r.file)
        console.log(
          col(assertion.label, 24) +
          col(relFile, 42) +
          numCol(r.line, 6) +
          '  ' + col(r.expected, 10) +
          '  ' + c('red', r.actual === '' ? '(not found)' : r.actual),
        )
        if (r.note) {
          console.log(c('dim', '  '.padEnd(25) + r.note))
        }
      }
    }
    console.log(c('dim', RULE))

    const totalMismatches = failingAssertions.reduce(
      (sum, a) => sum + a.results.filter((r) => r.status === 'fail').length,
      0,
    )
    console.log(c('red', `✗ ${totalMismatches} mismatch(es) — update the file(s) listed above`))
  } else if (totalError > 0) {
    const errorAssertions = assertions.filter((a) => a.status === 'error')
    console.log('')
    console.log(c('bold', 'Errors'))
    console.log(c('dim', RULE))
    for (const assertion of errorAssertions) {
      console.log(c('red', `  ${assertion.label}: ${assertion.error ?? 'unknown error'}`))
    }
    console.log(c('dim', RULE))
  } else if (totalWarn > 0) {
    console.log(
      c('green', `✓ ${totalPass} pass`) +
      c('yellow', ` · ⚠ ${totalWarn} warn`) +
      (totalSkip > 0 ? c('dim', ` · ${totalSkip} skipped`) : ''),
    )
  } else if (totalSkip > 0) {
    console.log(
      c('green', `✓ ${totalPass} pass`) +
      c('dim', ` · ${totalSkip} skipped (allowlisted)`),
    )
  } else {
    console.log(c('green', `✓ All ${totalPass} assertion${totalPass !== 1 ? 's' : ''} passed`))
  }

  console.log(
    c('dim', `\nScanned ${totalFiles} file(s) across ${assertions.length} assertion${assertions.length !== 1 ? 's' : ''} in ${Math.round(durationMs)}ms`),
  )
}

// ─── JSON reporter ────────────────────────────────────────────────────────────

function reportJson(result: RunResult): void {
  console.log(JSON.stringify(result, null, 2))
}

// ─── GHA reporter ─────────────────────────────────────────────────────────────

/**
 * Emits GitHub Actions workflow commands for each assertion result.
 *
 * fail       → ::error   file=…,line=…::ctxharness[id] expected "X" but found "Y"
 * no-mention → ::warning file=…,line=0::ctxharness[id] no mention found
 * error      → ::error   ::ctxharness[id] extractor error: <message>
 * pass       → (no output)
 */
function reportGha(result: RunResult): void {
  for (const assertion of result.assertions) {
    switch (assertion.status) {
      case 'pass':
        // Nothing to emit for passing assertions
        break

      case 'fail': {
        const failResults = assertion.results.filter((r) => r.status === 'fail')
        for (const r of failResults) {
          const relFile = relative(process.cwd(), r.file)
          const actual = r.actual === '' ? '(not found)' : r.actual
          console.log(
            `::error file=${relFile},line=${r.line}::ctxharness[${assertion.id}] expected "${r.expected}" but found "${actual}"`,
          )
        }
        break
      }

      case 'no-mention': {
        // Emit a warning per scanned file (or a generic one if no files were scanned)
        const files = assertion.results.map((r) => r.file)
        if (files.length > 0) {
          for (const filePath of files) {
            const relFile = relative(process.cwd(), filePath)
            console.log(
              `::warning file=${relFile},line=0::ctxharness[${assertion.id}] no mention found`,
            )
          }
        } else {
          console.log(`::warning::ctxharness[${assertion.id}] no mention found in any scanned file`)
        }
        break
      }

      case 'error':
        console.log(
          `::error::ctxharness[${assertion.id}] extractor error: ${assertion.error ?? 'unknown'}`,
        )
        break
    }
  }
}
