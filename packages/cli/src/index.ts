#!/usr/bin/env node
import { Command } from 'commander'
import { resolve, join } from 'node:path'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { loadConfig, run, report } from '@ctxharness/core'
import type { OutputFormat, AssertionResult } from '@ctxharness/core'

// ─── Score helpers ────────────────────────────────────────────────────────────

function computeScore(assertions: AssertionResult[]): { score: number; grade: string } {
  const total = assertions.length
  if (total === 0) return { score: 100, grade: 'S' }

  const weightPer = 100 / total
  let points = 0
  for (const a of assertions) {
    if (a.status === 'pass' || a.status === 'skip') points += weightPer
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
        chalk.dim(`  pass ${result.totalPass}  ·  fail ${result.totalFail}  ·  skip ${result.totalSkip}  ·  error ${result.totalError}`),
      )
      console.log('')

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

program.parse()
