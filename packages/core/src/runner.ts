import type { CtxharnessConfig } from './config.js'
import { runExtractor } from './extractors/index.js'
import { runScanner } from './scanners/index.js'
import type { ScanResult } from './scanners/index.js'
import fg from 'fast-glob'

export type AssertionResult = {
  id: string
  label: string
  expected: string | null
  error: string | null
  results: ScanResult[]
  status: 'pass' | 'fail' | 'error' | 'no-mention' | 'skip'
}

export type RunResult = {
  assertions: AssertionResult[]
  totalPass: number
  totalFail: number
  totalError: number
  totalSkip: number
  durationMs: number
}

export async function run(config: CtxharnessConfig, root: string): Promise<RunResult> {
  const t0 = performance.now()

  // 1. Collect files to scan via glob
  const files = await fg(config.files.include, {
    cwd: root,
    ignore: config.files.exclude,
    absolute: true,
    onlyFiles: true,
  })

  // 2. Process each assertion
  const assertions: AssertionResult[] = config.assertions.map((assertion) => {
    let expected: string | null = null
    let error: string | null = null
    let results: ScanResult[] = []

    // Run extractor to get the ground-truth value
    try {
      expected = runExtractor(assertion.extractor, root, assertion.extractorArgs ?? {})
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      return {
        id: assertion.id,
        label: assertion.label ?? assertion.id,
        expected: null,
        error,
        results: [],
        status: 'error',
      }
    }

    // Run the scanner on every matched file
    for (const filePath of files) {
      try {
        const fileResults = runScanner(
          assertion.scanner,
          filePath,
          expected,
          assertion.scannerArgs ?? {},
        )
        results = results.concat(fileResults)
      } catch {
        // Scanner error on one file — record as a fail result and continue
        results.push({
          file: filePath,
          line: 0,
          actual: '',
          expected,
          status: 'fail',
        })
      }
    }

    // Apply allowlist: mark fail results from allowlisted files as 'skip'
    if (assertion.allowlist && assertion.allowlist.length > 0) {
      results = results.map((r) => {
        if (r.status !== 'fail') return r
        const isAllowlisted = assertion.allowlist!.some(
          (pattern) => r.file.endsWith(pattern) || r.file.includes(pattern),
        )
        return isAllowlisted ? { ...r, status: 'skip' as const } : r
      })
    }

    // Determine overall status for this assertion:
    //   - 'fail'       if any (non-allowlisted) result has status === 'fail'
    //   - 'skip'       if fails existed but all were allowlisted (no real pass either)
    //   - 'no-mention' if nothing was found anywhere (no matches at all)
    //   - 'pass'       otherwise
    const hasFail = results.some((r) => r.status === 'fail')
    const hasSkip = results.some((r) => r.status === 'skip')
    const hasMentions = results.some((r) => r.actual !== '' || r.status === 'pass')

    let status: AssertionResult['status']
    if (hasFail) {
      status = 'fail'
    } else if (hasMentions) {
      status = 'pass'
    } else if (hasSkip) {
      status = 'skip'
    } else {
      status = 'no-mention'
    }

    return {
      id: assertion.id,
      label: assertion.label ?? assertion.id,
      expected,
      error: null,
      results,
      status,
    }
  })

  const durationMs = performance.now() - t0
  const totalPass = assertions.filter((a) => a.status === 'pass').length
  const totalFail = assertions.filter((a) => a.status === 'fail').length
  const totalError = assertions.filter((a) => a.status === 'error').length
  const totalSkip = assertions.filter((a) => a.status === 'skip').length

  return { assertions, totalPass, totalFail, totalError, totalSkip, durationMs }
}
