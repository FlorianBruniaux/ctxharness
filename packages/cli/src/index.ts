#!/usr/bin/env node
import { Command } from 'commander'
import { resolve, join, basename } from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { relative } from 'node:path'
import fg from 'fast-glob'
import { loadConfig, run, report, buildSnapshot, saveSnapshot, loadSnapshot, findLatestSnapshot, diffSnapshots, scanFile, detectIncludes, appendTrendRecord, populateFromConfig, assertionsToYaml } from '@florianbruniaux/ctxharness-core'
import type { OutputFormat, AssertionResult, HeuristicResult, HeuristicClaim, TrendRecord, RunResult } from '@florianbruniaux/ctxharness-core'

// ─── Score helpers ────────────────────────────────────────────────────────────

function computeScore(assertions: AssertionResult[]): { score: number; grade: string } {
  const total = assertions.length
  if (total === 0) return { score: 100, grade: 'S' }

  const weightPer = 100 / total
  let points = 0
  for (const a of assertions) {
    if (a.status === 'pass' || a.status === 'skip') points += weightPer
    else if (a.status === 'warn') points += 0.5 * weightPer
  }

  const score = Math.round(points)
  let grade: string
  if (score === 100) grade = 'S'
  else if (score >= 90) grade = 'A'
  else if (score >= 75) grade = 'B'
  else if (score >= 60) grade = 'C'
  else if (score >= 40) grade = 'D'
  else grade = 'F'

  return { score, grade }
}

function recordTrend(result: RunResult, root: string): void {
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
  } satisfies TrendRecord)
}

const program = new Command()

program
  .name('ctxharness')
  .description('Detect AI documentation drift — L1/L2/L3 context engineering testing')
  .version('0.4.6')

// ─── run command ──────────────────────────────────────────────────────────────

program
  .command('run')
  .description('Run all assertions and report results')
  .option('-c, --config <path>', 'Path to config file', '.ctxharness.yml')
  .option('-f, --format <fmt>', 'Output format: text | json | gha', 'text')
  .option('-r, --root <dir>', 'Project root directory', '')
  .option('-w, --watch', 'Re-run on file changes (fs.watch, recursive)')
  .option('--no-trend', 'Skip recording this run to trend history')
  .action(async (opts: { config: string; format: string; root: string; watch?: boolean; trend: boolean }) => {
    try {
      const cwd = process.cwd()
      const configPath = resolve(cwd, opts.config)
      const root = opts.root !== '' ? resolve(cwd, opts.root) : cwd
      const format = opts.format as OutputFormat

      if (!existsSync(configPath)) {
        process.stderr.write(
          `Error: config file not found: ${configPath}\n` +
          `  Run \`ctxharness init\` to create one.\n`,
        )
        process.exit(1)
      }

      const doRun = async () => {
        const config = loadConfig(configPath)
        const result = await run(config, root)
        report(result, format)
        return result
      }

      if (opts.watch === true) {
        const { watch: fsWatch } = await import('node:fs')
        const { default: chalk } = await import('chalk')

        process.stdout.write(chalk.dim(`[watch] monitoring ${root} — Ctrl+C to stop\n\n`))

        let debounce: ReturnType<typeof setTimeout> | null = null
        await doRun()

        fsWatch(root, { recursive: true }, (_event: string, filename: string | Buffer | null) => {
          const fname = typeof filename === 'string' ? filename : ''
          if (fname.includes('node_modules') || fname.startsWith('.git')) return

          if (debounce) clearTimeout(debounce)
          debounce = setTimeout(() => {
            process.stdout.write(chalk.dim('\n[watch] change detected — re-running...\n\n'))
            void doRun()
          }, 300)
        })

        return // Keep process alive — no process.exit
      }

      const result = await doRun()
      if (opts.trend !== false) recordTrend(result, root)
      process.exit(result.totalFail > 0 || result.totalError > 0 ? 1 : 0)
    } catch (e) {
      process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`)
      process.exit(1)
    }
  })

// ─── check command ────────────────────────────────────────────────────────────

program
  .command('check')
  .description('Run assertions with text output (alias for run --format text)')
  .option('-c, --config <path>', 'Path to config file', '.ctxharness.yml')
  .option('-r, --root <dir>', 'Project root directory', '')
  .option('--no-trend', 'Skip recording to trend history')
  .action(async (opts: { config: string; root: string; trend: boolean }) => {
    try {
      const cwd = process.cwd()
      const configPath = resolve(cwd, opts.config)
      const root = opts.root !== '' ? resolve(cwd, opts.root) : cwd

      if (!existsSync(configPath)) {
        process.stderr.write(
          `Error: config file not found: ${configPath}\n` +
          `  Run \`ctxharness init\` to create one.\n`,
        )
        process.exit(1)
      }

      const config = loadConfig(configPath)
      const result = await run(config, root)
      report(result, 'text')
      if (opts.trend !== false) recordTrend(result, root)

      process.exit(result.totalFail > 0 || result.totalError > 0 ? 1 : 0)
    } catch (e) {
      process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`)
      process.exit(1)
    }
  })

// ─── score command ────────────────────────────────────────────────────────────

program
  .command('score')
  .description('Run assertions and report a 0-100 context health score')
  .option('-c, --config <path>', 'Path to config file', '.ctxharness.yml')
  .option('-r, --root <dir>', 'Project root directory', '')
  .option('--no-trend', 'Skip recording to trend history')
  .action(async (opts: { config: string; root: string; trend: boolean }) => {
    try {
      const cwd = process.cwd()
      const configPath = resolve(cwd, opts.config)
      const root = opts.root !== '' ? resolve(cwd, opts.root) : cwd

      if (!existsSync(configPath)) {
        process.stderr.write(
          `Error: config file not found: ${configPath}\n` +
          `  Run \`ctxharness init\` to create one.\n`,
        )
        process.exit(1)
      }

      const { default: chalk } = await import('chalk')

      const config = loadConfig(configPath)
      const result = await run(config, root)
      const { score, grade } = computeScore(result.assertions)

      const gradeColor =
        grade === 'S' || grade === 'A' ? 'green'
          : grade === 'B' ? 'cyan'
          : grade === 'C' ? 'yellow'
          : 'red'

      console.log('')
      console.log(`Context Health Score — ${result.assertions.length} assertion${result.assertions.length !== 1 ? 's' : ''}`)
      console.log('')
      console.log(
        `  ${chalk[gradeColor].bold(`${score} / 100`)}   ${chalk[gradeColor].bold(grade)}`,
      )
      console.log('')
      console.log(
        chalk.dim(`  pass ${result.totalPass}  ·  warn ${result.totalWarn}  ·  fail ${result.totalFail}  ·  skip ${result.totalSkip}  ·  error ${result.totalError}`),
      )
      console.log('')
      console.log(chalk.dim(`  Run ${chalk.cyan('ctxharness trend')} to see history.\n`))
      if (opts.trend !== false) recordTrend(result, root)

      process.exit(result.totalFail > 0 || result.totalError > 0 ? 1 : 0)
    } catch (e) {
      process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`)
      process.exit(1)
    }
  })

// ─── fix command ──────────────────────────────────────────────────────────────

/**
 * Collects fixable fail results: must have a line number and a non-empty actual value.
 * Groups them by file, sorted by line descending so multi-fix on one file doesn't shift offsets.
 */
type Fix = { file: string; line: number; actual: string; expected: string; assertionId: string }

function collectFixes(assertions: AssertionResult[]): Fix[] {
  const fixes: Fix[] = []
  for (const assertion of assertions) {
    if (assertion.status !== 'fail' || assertion.expected === null) continue
    for (const r of assertion.results) {
      if (r.status !== 'fail' || r.line === 0 || r.actual === '') continue
      fixes.push({
        file: r.file,
        line: r.line,
        actual: r.actual,
        expected: r.expected,
        assertionId: assertion.id,
      })
    }
  }
  // Sort descending by line so multi-line fixes on the same file don't shift offsets
  return fixes.sort((a, b) => b.line - a.line || a.file.localeCompare(b.file))
}

function applyFix(fix: Fix): boolean {
  const lines = readFileSync(fix.file, 'utf-8').split('\n')
  const lineIdx = fix.line - 1
  const original = lines[lineIdx]
  if (original === undefined || !original.includes(fix.actual)) return false
  lines[lineIdx] = original.replace(fix.actual, fix.expected)
  writeFileSync(fix.file, lines.join('\n'), 'utf-8')
  return true
}

program
  .command('fix')
  .description('Auto-fix version drift in AI doc files (dry-run by default)')
  .option('-c, --config <path>', 'Path to config file', '.ctxharness.yml')
  .option('-r, --root <dir>', 'Project root directory', '')
  .option('--apply', 'Write changes to files (default: dry-run, shows what would change)')
  .action(async (opts: { config: string; root: string; apply?: boolean }) => {
    try {
      const cwd = process.cwd()
      const configPath = resolve(cwd, opts.config)
      const root = opts.root !== '' ? resolve(cwd, opts.root) : cwd

      if (!existsSync(configPath)) {
        process.stderr.write(`Error: config file not found: ${configPath}\n`)
        process.exit(1)
      }

      const { default: chalk } = await import('chalk')

      const config = loadConfig(configPath)
      const result = await run(config, root)
      const fixes = collectFixes(result.assertions)

      if (fixes.length === 0) {
        console.log(chalk.green('\n✓ Nothing to fix — all assertions pass\n'))
        process.exit(0)
      }

      if (opts.apply !== true) {
        console.log(chalk.bold(`\nFixable drift — ${fixes.length} change${fixes.length !== 1 ? 's' : ''}\n`))
        for (const fix of [...fixes].sort((a, b) => a.line - b.line)) {
          const relFile = relative(cwd, fix.file)
          console.log(
            `  ${chalk.dim(`${relFile}:${fix.line}`)}  ${chalk.dim(fix.assertionId)}  ` +
            `${chalk.red(fix.actual)} → ${chalk.green(fix.expected)}`,
          )
        }
        console.log(chalk.dim(`\nRun ctxharness fix --apply to write changes.\n`))
        process.exit(0)
      }

      // Apply mode
      let applied = 0
      let failed = 0
      console.log(chalk.bold(`\nApplying ${fixes.length} fix${fixes.length !== 1 ? 'es' : ''}...\n`))

      for (const fix of [...fixes].sort((a, b) => a.line - b.line)) {
        const relFile = relative(cwd, fix.file)
        if (applyFix(fix)) {
          applied++
          console.log(
            `  ${chalk.green('✓')} ${chalk.dim(`${relFile}:${fix.line}`)}  ` +
            `${chalk.red(fix.actual)} → ${chalk.green(fix.expected)}`,
          )
        } else {
          failed++
          console.log(
            `  ${chalk.yellow('⚠')} ${chalk.dim(`${relFile}:${fix.line}`)}  ` +
            chalk.dim(`could not apply (pattern not found on line)`),
          )
        }
      }

      console.log('')
      if (failed > 0) {
        console.log(chalk.yellow(`Applied ${applied}, skipped ${failed} (review manually)`))
      } else {
        console.log(chalk.green(`✓ Applied ${applied} fix${applied !== 1 ? 'es' : ''}`))
      }
      console.log('')
      process.exit(failed > 0 ? 1 : 0)
    } catch (e) {
      process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`)
      process.exit(1)
    }
  })

// ─── doctor command ───────────────────────────────────────────────────────────

const L1_SCANNERS = new Set([
  'inlineRegex', 'codeBlockRegex', 'yamlField', 'jsonField',
  'literalInMd', 'pathReference', 'backtickEntityPresence',
])
const L2_SCANNERS = new Set([
  'vaguenessPattern', 'negativeConstraintDensity', 'contextBudget', 'skillValidity',
])
const L3_SCANNERS = new Set(['ruleGlobValidity', 'hookValidity'])

function getLayer(scanner: string): string {
  if (L1_SCANNERS.has(scanner)) return 'L1'
  if (L2_SCANNERS.has(scanner)) return 'L2'
  if (L3_SCANNERS.has(scanner)) return 'L3'
  return '??'
}

program
  .command('doctor')
  .description('Comprehensive health check of AI context assembly')
  .option('-c, --config <path>', 'Path to config file', '.ctxharness.yml')
  .option('-r, --root <dir>', 'Project root directory', '')
  .option('--no-trend', 'Skip recording to trend history')
  .action(async (opts: { config: string; root: string; trend: boolean }) => {
    try {
      const cwd = process.cwd()
      const configPath = resolve(cwd, opts.config)
      const root = opts.root !== '' ? resolve(cwd, opts.root) : cwd

      if (!existsSync(configPath)) {
        process.stderr.write(`Error: config file not found: ${configPath}\n`)
        process.exit(1)
      }

      const { default: chalk } = await import('chalk')

      const config = loadConfig(configPath)
      const result = await run(config, root)
      const { score, grade } = computeScore(result.assertions)

      // Build assertion → scanner map from config
      const assertionScanner = new Map(config.assertions.map((a) => [a.id, a.scanner]))

      // Categorize by layer
      const byLayer: Record<string, AssertionResult[]> = { L1: [], L2: [], L3: [], '??': [] }
      for (const assertion of result.assertions) {
        const scanner = assertionScanner.get(assertion.id) ?? ''
        const layer = getLayer(scanner)
        byLayer[layer]!.push(assertion)
      }

      const totalFiles = new Set(
        result.assertions.flatMap((a) => a.results.map((r) => r.file)),
      ).size

      // Header
      console.log(chalk.bold('\nContext Assembly Report\n'))

      // Status lines
      const cfgOk = chalk.green('✓ valid')
      console.log(`Config       ${cfgOk} (${relative(cwd, configPath)})`)
      console.log(`Files        ${chalk.green('✓')} ${totalFiles} file${totalFiles !== 1 ? 's' : ''} scanned`)
      console.log(`Assertions   ${result.assertions.length} defined\n`)

      // Per-layer summary
      for (const layer of ['L1', 'L2', 'L3'] as const) {
        const assertions = byLayer[layer] ?? []
        if (assertions.length === 0) continue
        const pass = assertions.filter((a) => a.status === 'pass' || a.status === 'skip').length
        const fail = assertions.filter((a) => a.status === 'fail').length
        const warn = assertions.filter((a) => a.status === 'warn').length
        const noMention = assertions.filter((a) => a.status === 'no-mention').length
        const error = assertions.filter((a) => a.status === 'error').length

        const layerLabel =
          layer === 'L1' ? 'Doc Drift   ' :
          layer === 'L2' ? 'Quality     ' : 'Assembly    '

        const parts = [
          pass > 0 ? chalk.green(`${pass} pass`) : '',
          fail > 0 ? chalk.red(`${fail} fail`) : '',
          warn > 0 ? chalk.yellow(`${warn} warn`) : '',
          noMention > 0 ? chalk.yellow(`${noMention} no-mention`) : '',
          error > 0 ? chalk.red(`${error} error`) : '',
        ].filter(Boolean).join(' · ')

        console.log(`${layer}  ${layerLabel}  ${parts || chalk.dim('none')}`)
      }

      // Score
      const gradeColor =
        grade === 'S' || grade === 'A' ? 'green'
          : grade === 'B' ? 'cyan'
          : grade === 'C' ? 'yellow' : 'red'

      console.log('')
      console.log(`Score  ${chalk[gradeColor].bold(`${score}/100`)}  ${chalk[gradeColor].bold(grade)}`)
      console.log('')

      // Issues
      const failing = result.assertions.filter((a) => a.status === 'fail' || a.status === 'error' || a.status === 'no-mention' || a.status === 'warn')
      if (failing.length > 0) {
        console.log(chalk.bold('Issues'))
        for (const assertion of failing) {
          const scanner = assertionScanner.get(assertion.id) ?? ''
          const layer = getLayer(scanner)
          const icon = assertion.status === 'fail' ? chalk.red('✗') : assertion.status === 'warn' ? chalk.yellow('⚠') : chalk.yellow('–')

          if (assertion.status === 'fail') {
            const firstFail = assertion.results.find((r) => r.status === 'fail')
            const where = firstFail ? `${relative(cwd, firstFail.file)}:${firstFail.line}` : ''
            console.log(
              `  ${icon} ${chalk.dim(`[${layer}]`)} ${assertion.label}` +
              (where ? `  ${chalk.dim(where)}` : '') +
              `  found "${firstFail?.actual}" expected "${firstFail?.expected}"`,
            )
          } else if (assertion.status === 'warn') {
            const firstWarn = assertion.results.find((r) => r.status === 'warn')
            const where = firstWarn ? `${relative(cwd, firstWarn.file)}:${firstWarn.line}` : ''
            console.log(
              `  ${icon} ${chalk.dim(`[warn]`)} ${chalk.dim(`[${layer}]`)} ${assertion.label}` +
              (where ? `  ${chalk.dim(where)}` : '') +
              (firstWarn ? `  ${chalk.yellow(firstWarn.actual)}` : ''),
            )
          } else if (assertion.status === 'no-mention') {
            console.log(
              `  ${icon} ${chalk.dim(`[${layer}]`)} ${assertion.label}  ` +
              chalk.dim('not mentioned in any scanned file'),
            )
          } else {
            console.log(
              `  ${icon} ${chalk.dim(`[${layer}]`)} ${assertion.label}  ` +
              chalk.red(assertion.error ?? 'extractor error'),
            )
          }
        }
        console.log('')
      }

      // Recommendations
      const fixable = collectFixes(result.assertions)
      const noMentionCount = result.assertions.filter((a) => a.status === 'no-mention').length

      if (fixable.length > 0 || noMentionCount > 0) {
        console.log(chalk.bold('Recommendations'))
        if (fixable.length > 0) {
          console.log(`  → Run ${chalk.cyan('ctxharness fix --apply')} to auto-fix ${fixable.length} drift${fixable.length !== 1 ? 's' : ''}`)
        }
        if (noMentionCount > 0) {
          console.log(`  → ${noMentionCount} assertion${noMentionCount !== 1 ? 's' : ''} have no mention — add them to your AI docs`)
        }
        console.log('')
      }

      if (opts.trend !== false) recordTrend(result, root)

      process.exit(result.totalFail > 0 || result.totalError > 0 ? 1 : 0)
    } catch (e) {
      process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`)
      process.exit(1)
    }
  })

// ─── init command ─────────────────────────────────────────────────────────────

const STARTER_TEMPLATE = `# ctxharness configuration — https://ctxharness.bruniaux.com
version: 1

files:
  include:
    - 'CLAUDE.md'
    - 'AGENTS.md'
    - '.cursorrules'
    - 'doc/**/*.md'
    - 'docs/**/*.md'
  exclude:
    - 'node_modules/**'

assertions:
  # Example: check Node.js version matches .nvmrc
  - id: node-version
    label: 'Node.js version'
    extractor: nvmrc
    scanner: inlineRegex
    scannerArgs:
      pattern: 'Node(?:\\.js)?\\s+v?(\\d+(?:\\.\\d+(?:\\.\\d+)?)?)'

  # Example: check a package version matches package.json
  # - id: my-package-version
  #   extractor: packageJson
  #   extractorArgs:
  #     package: typescript
  #   scanner: inlineRegex
  #   scannerArgs:
  #     pattern: 'TypeScript\\s+v?(\\d+(?:\\.\\d+(?:\\.\\d+)?)?)'
`

const HOOK_SCRIPT = `#!/usr/bin/env bash
# ctxharness hook — installed by ctxharness init --hooks
if command -v ctxharness &>/dev/null; then
  ctxharness check || echo "⚠  AI doc drift detected. Run: ctxharness run"
fi
`

program
  .command('init')
  .description('Create a starter .ctxharness.yml in the current directory')
  .option('--hooks', 'Also install Husky hooks (post-merge, post-checkout, post-rewrite)')
  .action((opts: { hooks?: boolean }) => {
    try {
      const cwd = process.cwd()
      const dest = join(cwd, '.ctxharness.yml')

      if (existsSync(dest)) {
        console.log('.ctxharness.yml already exists. Remove it first if you want to regenerate.')
        process.exit(0)
      }

      // Try to auto-generate assertions from existing AI doc files
      const candidateFiles = ['CLAUDE.md', 'AGENTS.md', '.cursorrules']
      const found = candidateFiles.filter((f) => existsSync(join(cwd, f)))

      let configContent = STARTER_TEMPLATE
      let autoGenerated = false

      if (found.length > 0) {
        const allResults: HeuristicResult[] = []
        for (const f of found) {
          const filePath = join(cwd, f)
          try {
            const fileResults = scanFile(filePath, cwd)
            allResults.push(...fileResults)
          } catch {
            // skip unreadable files
          }
        }

        if (allResults.length > 0) {
          const filesInclude = found.map((f) => `    - ${yamlQ(f)}`).join('\n')
          const assertionsYaml = buildSuggestedAssertions(allResults)
          configContent = [
            '# ctxharness configuration — generated by ctxharness init',
            'version: 1',
            '',
            'files:',
            '  include:',
            filesInclude,
            '  exclude:',
            "    - 'node_modules/**'",
            '',
            'assertions:',
            assertionsYaml,
          ].join('\n') + '\n'
          autoGenerated = true
        }
      }

      writeFileSync(dest, configContent, 'utf8')

      if (autoGenerated) {
        console.log(`✓ Created .ctxharness.yml — scanned ${found.join(', ')} and generated assertions from detected claims`)
        console.log('  Run ctxharness run to enforce them.')
        console.log('  Edit the file to add or remove assertions.')
      } else {
        console.log('✓ Created .ctxharness.yml')
        console.log('  Run ctxharness run to check your AI docs.')
        console.log('  Edit the file to add your project-specific assertions.')
        if (found.length === 0) {
          console.log('  Tip: no CLAUDE.md / AGENTS.md found — create one first, then re-run ctxharness init.')
        }
      }

      if (opts.hooks === true) {
        const hookDir = join(cwd, 'scripts')
        if (!existsSync(hookDir)) {
          mkdirSync(hookDir, { recursive: true })
        }
        const hookPath = join(hookDir, 'ctxharness-hook.sh')
        writeFileSync(hookPath, HOOK_SCRIPT, { mode: 0o755, encoding: 'utf8' })

        console.log('')
        console.log('✓ Created scripts/ctxharness-hook.sh')
        console.log('  Add it to your Husky hooks:')
        console.log('    echo "bash scripts/ctxharness-hook.sh" >> .husky/post-merge')
        console.log('    echo "bash scripts/ctxharness-hook.sh" >> .husky/post-checkout')
        console.log('    echo "bash scripts/ctxharness-hook.sh" >> .husky/post-rewrite')
      }
    } catch (e) {
      process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`)
      process.exit(1)
    }
  })

// ─── snapshot command ─────────────────────────────────────────────────────────

program
  .command('snapshot')
  .description('Run all assertions and save result to .ctxharness/snapshots/{timestamp}.json')
  .option('-c, --config <path>', 'Path to config file', '.ctxharness.yml')
  .option('-r, --root <dir>', 'Project root directory', '')
  .action(async (opts: { config: string; root: string }) => {
    try {
      const cwd = process.cwd()
      const configPath = resolve(cwd, opts.config)
      const root = opts.root !== '' ? resolve(cwd, opts.root) : cwd

      if (!existsSync(configPath)) {
        process.stderr.write(`Error: config file not found: ${configPath}\n`)
        process.exit(1)
      }

      const config = loadConfig(configPath)
      const result = await run(config, root)
      const { score, grade } = computeScore(result.assertions)

      const snapshot = buildSnapshot(result, score, grade, root)
      const savedPath = saveSnapshot(snapshot, root)
      const relPath = relative(cwd, savedPath)

      const { default: chalk } = await import('chalk')
      const gradeColor =
        grade === 'S' || grade === 'A' ? 'green'
          : grade === 'B' ? 'cyan'
          : grade === 'C' ? 'yellow'
          : 'red'

      console.log(
        `Snapshot saved: ${chalk.dim(relPath)}  Score: ${chalk[gradeColor].bold(`${score}/100 ${grade}`)}`,
      )

      process.exit(result.totalFail > 0 || result.totalError > 0 ? 1 : 0)
    } catch (e) {
      process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`)
      process.exit(1)
    }
  })

// ─── diff command ─────────────────────────────────────────────────────────────

program
  .command('diff [baseline]')
  .description('Compare current run against a snapshot. If no baseline given, uses the latest snapshot.')
  .option('-c, --config <path>', 'Path to config file', '.ctxharness.yml')
  .option('-r, --root <dir>', 'Project root directory', '')
  .action(async (baseline: string | undefined, opts: { config: string; root: string }) => {
    try {
      const cwd = process.cwd()
      const configPath = resolve(cwd, opts.config)
      const root = opts.root !== '' ? resolve(cwd, opts.root) : cwd

      if (!existsSync(configPath)) {
        process.stderr.write(`Error: config file not found: ${configPath}\n`)
        process.exit(1)
      }

      const { default: chalk } = await import('chalk')

      // Resolve baseline snapshot
      const baselinePath = baseline
        ? resolve(cwd, baseline)
        : findLatestSnapshot(root)

      if (baselinePath === null || !existsSync(baselinePath)) {
        process.stderr.write(
          `Error: no snapshot found. Run \`ctxharness snapshot\` first.\n`,
        )
        process.exit(1)
      }

      const baselineSnapshot = loadSnapshot(baselinePath)

      // Run current assertions
      const config = loadConfig(configPath)
      const result = await run(config, root)
      const { score, grade } = computeScore(result.assertions)
      const currentSnapshot = buildSnapshot(result, score, grade, root)

      const diff = diffSnapshots(baselineSnapshot, currentSnapshot)

      console.log(chalk.bold('\nSnapshot diff\n'))

      const baselineLabel = baseline ?? relative(root, baselinePath)
      console.log(`Baseline  ${chalk.dim(baselineSnapshot.timestamp ?? baselineLabel)}`)
      console.log(`Current   ${chalk.dim('now')}`)
      console.log('')

      const scoreDeltaStr = diff.scoreDelta === 0
        ? chalk.dim('±0')
        : diff.scoreDelta > 0
          ? chalk.green(`+${diff.scoreDelta}`)
          : chalk.red(String(diff.scoreDelta))

      console.log(`Score     ${diff.scoresBefore} → ${diff.scoresAfter}  (${scoreDeltaStr})`)
      console.log(`Grade     ${diff.gradeBefore} → ${diff.gradeAfter}`)
      console.log('')

      if (diff.changed.length > 0) {
        console.log(chalk.bold(`Changes (${diff.changed.length})`))
        for (const entry of diff.changed) {
          const beforeColor = entry.before === 'pass' ? 'green' : entry.before === 'warn' ? 'yellow' : 'red'
          const afterColor = entry.after === 'pass' ? 'green' : entry.after === 'warn' ? 'yellow' : 'red'
          console.log(
            `  ${chalk[beforeColor](entry.before.toUpperCase())} → ${chalk[afterColor](entry.after.toUpperCase())}  ${entry.id}`,
          )
        }
        console.log('')
      }

      console.log(chalk.dim(`Unchanged: ${diff.unchanged.length} assertion${diff.unchanged.length !== 1 ? 's' : ''}`))
      console.log('')

      // Exit 1 if score regressed
      process.exit(diff.scoreDelta < 0 ? 1 : 0)
    } catch (e) {
      process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`)
      process.exit(1)
    }
  })

// ─── scan command ─────────────────────────────────────────────────────────────

const SCAN_SEP = '─'.repeat(68)
const COL_CLAIM = 24
const COL_DETECTED = 16
const COL_ACTUAL = 16
const COL_STATUS = 12

function truncate(s: string, width: number): string {
  const max = width - 2
  return s.length > max ? s.slice(0, max) + '…' : s
}

function padRight(s: string, width: number): string {
  return s.padEnd(width)
}

function claimDisplayName(r: HeuristicResult): string {
  if (r.claim.type === 'semver') return r.claim.tech
  if (r.claim.type === 'path') return r.claim.value
  return r.claim.raw
}

function detectedDisplay(r: HeuristicResult): string {
  if (r.claim.type === 'semver') return r.claim.value
  return 'mentioned'
}

function actualDisplay(r: HeuristicResult): string {
  return r.actual
}

function yamlQ(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

function buildSuggestedAssertions(results: HeuristicResult[]): string {
  const resolvable = results.filter((r) => r.status !== 'unresolvable')
  const lines: string[] = []

  const seenIds = new Set<string>()

  for (const r of resolvable) {
    const { claim } = r
    if (claim.type === 'semver') {
      const tech = claim.tech
      const id = `${tech}-version`
      if (seenIds.has(id)) continue
      seenIds.add(id)
      if (tech === 'node' || tech === 'nodejs') {
        lines.push(`  - id: ${id}`)
        lines.push(`    extractor: nvmrc`)
        lines.push(`    scanner: inlineRegex`)
        lines.push(`    scannerArgs:`)
        lines.push(`      pattern: 'Node(?:\\.js)?\\s+v?(\\d+(?:\\.\\d+(?:\\.\\d+)?)?)'`)
      } else {
        lines.push(`  - id: ${id}`)
        lines.push(`    extractor: packageJson`)
        lines.push(`    extractorArgs:`)
        lines.push(`      package: ${tech}`)
        lines.push(`    scanner: inlineRegex`)
        lines.push(`    scannerArgs:`)
        lines.push(`      pattern: '${tech}\\s+v?(\\d+(?:\\.\\d+(?:\\.\\d+)?)?)'`)
      }
    } else if (claim.type === 'path') {
      const val = claim.value
      const safeId = val.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
      const id = `path-${safeId}`
      if (seenIds.has(id)) continue
      seenIds.add(id)
      lines.push(`  - id: ${id}`)
      lines.push(`    extractor: fileExists`)
      lines.push(`    extractorArgs:`)
      lines.push(`      path: ${yamlQ(val)}`)
      lines.push(`    scanner: literalInMd`)
      lines.push(`    scannerArgs:`)
      lines.push(`      literal: ${yamlQ(val)}`)
    } else if (claim.type === 'script') {
      const scriptName = claim.value
      const safeId = scriptName.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
      const id = `script-${safeId}`
      if (seenIds.has(id)) continue
      seenIds.add(id)
      lines.push(`  - id: ${id}`)
      lines.push(`    extractor: packageScript`)
      lines.push(`    extractorArgs:`)
      lines.push(`      script: ${yamlQ(scriptName)}`)
      lines.push(`    scanner: literalInMd`)
      lines.push(`    scannerArgs:`)
      lines.push(`      literal: ${yamlQ(claim.raw)}`)
    }
  }

  return lines.join('\n')
}

function buildSuggestedConfig(file: string, results: HeuristicResult[]): string {
  const lines: string[] = [
    '',
    'Suggested .ctxharness.yml based on detected claims:',
    '',
    'version: 1',
    'files:',
    '  include:',
    `    - ${yamlQ(file)}`,
    'assertions:',
    buildSuggestedAssertions(results),
  ]

  return lines.join('\n')
}

program
  .command('scan [file]')
  .description('Scan a markdown file for verifiable claims (semver, paths, scripts) and check them against ground truth')
  .option('-r, --root <dir>', 'Project root directory', '')
  .option('--suggest-config', 'Also print a starter .ctxharness.yml based on detected claims')
  .option('--exit-zero', 'Always exit 0 even when drifts are found (for use in hooks / warning-only CI steps)')
  .action(async (file: string | undefined, opts: { root: string; suggestConfig?: boolean; exitZero?: boolean }) => {
    try {
      const { default: chalk } = await import('chalk')
      const cwd = process.cwd()
      const targetFile = file ?? 'CLAUDE.md'
      const root = opts.root !== '' ? resolve(cwd, opts.root) : cwd
      const filePath = resolve(cwd, targetFile)

      if (!existsSync(filePath)) {
        process.stderr.write(`Error: file not found: ${filePath}\n`)
        process.exit(1)
      }

      // Hint when a config already exists — scan is heuristic/single-file, run is config-based/multi-file
      const configPath = join(cwd, '.ctxharness.yml')
      if (existsSync(configPath)) {
        process.stdout.write(`Tip: .ctxharness.yml found — \`ctxharness run\` enforces all configured files. \`scan\` is zero-config single-file discovery.\n\n`)
      }

      process.stdout.write(`Scanning ${targetFile} for verifiable claims...\n\n`)

      let results: HeuristicResult[]
      try {
        results = scanFile(filePath, root)
      } catch (err) {
        process.stderr.write(`Error reading file: ${err instanceof Error ? err.message : String(err)}\n`)
        process.exit(1)
      }

      if (results.length === 0) {
        const includes = detectIncludes(filePath)
        if (includes.length > 0) {
          process.stdout.write(`No verifiable claims found directly in ${targetFile}.\n`)
          process.stdout.write(`Included files were also scanned: ${includes.join(', ')}\n`)
        } else {
          process.stdout.write(`No verifiable claims found in ${targetFile}.\n`)
        }
        process.stdout.write(`Run \`ctxharness init\` to set up structured assertions.\n`)
        process.exit(0)
      }

      // Header row
      const header =
        padRight(truncate('claim', COL_CLAIM), COL_CLAIM) +
        padRight(truncate('detected', COL_DETECTED), COL_DETECTED) +
        padRight(truncate('actual', COL_ACTUAL), COL_ACTUAL) +
        padRight('status', COL_STATUS)

      process.stdout.write(header + '\n')
      process.stdout.write(SCAN_SEP + '\n')

      for (const r of results) {
        const claimCol = padRight(truncate(claimDisplayName(r), COL_CLAIM), COL_CLAIM)
        const detectedCol = padRight(truncate(detectedDisplay(r), COL_DETECTED), COL_DETECTED)
        const actualCol = padRight(truncate(actualDisplay(r), COL_ACTUAL), COL_ACTUAL)

        let statusStr: string
        if (r.status === 'match') {
          statusStr = chalk.green('✓ match')
        } else if (r.status === 'drift') {
          statusStr = chalk.red('✗ drift')
        } else {
          statusStr = chalk.yellow('? unknown')
        }

        process.stdout.write(claimCol + detectedCol + actualCol + statusStr + '\n')
      }

      process.stdout.write(SCAN_SEP + '\n')

      const driftCount = results.filter((r) => r.status === 'drift').length
      const unknownCount = results.filter((r) => r.status === 'unresolvable').length
      const matchCount = results.filter((r) => r.status === 'match').length

      if (driftCount > 0) {
        console.log(chalk.red(`✗ ${driftCount} drift${driftCount !== 1 ? 's' : ''} found`))
      } else if (unknownCount > 0) {
        console.log(chalk.green(`✓ ${matchCount} claim${matchCount !== 1 ? 's' : ''} verified, ${unknownCount} unknown`))
      } else {
        console.log(chalk.green('✓ All claims match'))
      }

      if (opts.suggestConfig === true) {
        process.stdout.write(buildSuggestedConfig(targetFile, results) + '\n')
      } else if (!existsSync(configPath)) {
        process.stdout.write(chalk.dim(`\nTip: run \`ctxharness scan ${targetFile} --suggest-config\` to generate a .ctxharness.yml, or \`ctxharness init\` to auto-generate from all AI doc files.\n`))
      }

      process.exit(driftCount > 0 && opts.exitZero !== true ? 1 : 0)
    } catch (e) {
      process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`)
      process.exit(1)
    }
  })

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
        console.log(chalk.dim(`\nNo trend history for "${projectName ?? 'all projects'}".`))
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

      const pad = (s: string, n: number) => s.padEnd(n)
      console.log(
        chalk.dim(
          `  ${pad('Date', 22)}  ${pad('Score', 9)}  ${pad('G', 6)}  ` +
          `${pad('Pass', 5)}  ${pad('Fail', 5)}  Time`
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
          `  ${pad(date, 22)}  ` +
          `${chalk[gradeColor](pad(`${r.score}/100`, 9))}  ` +
          `${chalk[gradeColor](pad(r.grade, 6))}  ` +
          `${pad(String(r.totalPass), 5)}  ` +
          `${pad(String(r.totalFail), 5)}  ` +
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

// ─── populate command ─────────────────────────────────────────────────────────

program
  .command('populate')
  .description('Scan declared files and suggest new assertions for uncovered claims')
  .option('-c, --config <path>', 'Path to config file', '.ctxharness.yml')
  .option('-r, --root <dir>', 'Project root directory', '')
  .option('--apply', 'Append suggested assertions to the config file (default: dry-run)')
  .action(async (opts: { config: string; root: string; apply?: boolean }) => {
    try {
      const { default: chalk } = await import('chalk')
      const cwd = process.cwd()
      const configPath = resolve(cwd, opts.config)
      const root = opts.root !== '' ? resolve(cwd, opts.root) : cwd

      if (!existsSync(configPath)) {
        process.stderr.write(
          `Error: config file not found: ${configPath}\n` +
          `  Run \`ctxharness init\` to create one.\n`,
        )
        process.exit(1)
      }

      const config = loadConfig(configPath)

      const expandedFiles = await fg(config.files.include, {
        cwd: root,
        ignore: config.files.exclude,
        absolute: true,
      })

      if (expandedFiles.length === 0) {
        console.log(chalk.yellow('\nNo files matched the include patterns in your config.\n'))
        console.log(chalk.dim(`  files.include: ${config.files.include.length > 0 ? config.files.include.join(', ') : '(none)'}\n`))
        process.exit(0)
      }

      const allClaims: HeuristicClaim[] = []
      for (const filePath of expandedFiles) {
        try {
          const results = scanFile(filePath, root)
          for (const r of results) allClaims.push(r.claim)
        } catch (err) {
          process.stderr.write(chalk.dim(`  warning: skipping ${relative(cwd, filePath)} — ${err instanceof Error ? err.message : String(err)}\n`))
        }
      }

      const { suggested, skippedIds } = populateFromConfig(config, allClaims)

      if (skippedIds.length > 0) {
        console.log(chalk.dim(`\nAlready covered (${skippedIds.length}): ${skippedIds.join(', ')}`))
      }

      if (suggested.length === 0) {
        console.log(chalk.green('\n✓ All detected claims are already covered — nothing to add.\n'))
        process.exit(0)
      }

      const yamlBlock = assertionsToYaml(suggested)

      if (opts.apply !== true) {
        console.log(chalk.bold(`\n${suggested.length} new assertion${suggested.length !== 1 ? 's' : ''} suggested:\n`))
        console.log(chalk.dim('─'.repeat(60)))
        console.log(yamlBlock)
        console.log(chalk.dim('─'.repeat(60)))
        console.log('')
        console.log(chalk.dim(`Run \`ctxharness populate --apply\` to append these to ${opts.config}.\n`))
        process.exit(0)
      }

      const existing = readFileSync(configPath, 'utf-8')
      const updated = existing.trimEnd() + '\n  # added by ctxharness populate\n' + yamlBlock + '\n'
      writeFileSync(configPath, updated, 'utf-8')

      try {
        loadConfig(configPath)
      } catch (err) {
        writeFileSync(configPath, existing, 'utf-8')
        process.stderr.write(
          `Error: appended YAML produced an invalid config — reverted.\n` +
          `  Reason: ${err instanceof Error ? err.message : String(err)}\n`,
        )
        process.exit(1)
      }

      console.log(chalk.green(`\n✓ Appended ${suggested.length} assertion${suggested.length !== 1 ? 's' : ''} to ${opts.config}\n`))
      console.log(chalk.dim(`  Run \`ctxharness run\` to enforce them.\n`))
      process.exit(0)
    } catch (e) {
      process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`)
      process.exit(1)
    }
  })

program.parse()
