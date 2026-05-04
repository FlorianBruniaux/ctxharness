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
  status: 'pass' | 'fail' | 'error' | 'no-mention'
}

export type RunResult = {
  assertions: AssertionResult[]
  totalPass: number
  totalFail: number
  totalError: number
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

    // Determine overall status for this assertion:
    //   - 'fail'       if any result has status === 'fail'
    //   - 'no-mention' if no result had a non-empty actual (nothing found anywhere)
    //   - 'pass'       otherwise
    const hasFail = results.some((r) => r.status === 'fail')
    const hasMentions = results.some((r) => r.actual !== '' || r.status === 'pass')

    let status: AssertionResult['status']
    if (hasFail) {
      status = 'fail'
    } else if (!hasMentions) {
      status = 'no-mention'
    } else {
      status = 'pass'
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

  return { assertions, totalPass, totalFail, totalError, durationMs }
}
