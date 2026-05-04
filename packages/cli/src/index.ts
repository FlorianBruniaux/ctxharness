#!/usr/bin/env node
import { Command } from 'commander'
import { resolve, join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { relative } from 'node:path'
import { loadConfig, run, report, buildSnapshot, saveSnapshot, loadSnapshot, findLatestSnapshot, diffSnapshots } from '@ctxharness/core'
import type { OutputFormat, AssertionResult } from '@ctxharness/core'

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

const program = new Command()

program
  .name('ctxharness')
  .description('Detect AI documentation drift — L1/L2/L3 context engineering testing')
  .version('0.1.0')

// ─── run command ──────────────────────────────────────────────────────────────

program
  .command('run')
  .description('Run all assertions and report results')
  .option('-c, --config <path>', 'Path to config file', '.ctxharness.yml')
  .option('-f, --format <fmt>', 'Output format: text | json | gha', 'text')
  .option('-r, --root <dir>', 'Project root directory', '')
  .option('-w, --watch', 'Re-run on file changes (fs.watch, recursive)')
  .action(async (opts: { config: string; format: string; root: string; watch?: boolean }) => {
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
  .action(async (opts: { config: string; root: string }) => {
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
  .action(async (opts: { config: string; root: string }) => {
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
  .action(async (opts: { config: string; root: string }) => {
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

      writeFileSync(dest, STARTER_TEMPLATE, 'utf8')

      console.log('✓ Created .ctxharness.yml')
      console.log('  Run ctxharness run to check your AI docs.')
      console.log('  Edit the file to add your project-specific assertions.')

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

program.parse()
