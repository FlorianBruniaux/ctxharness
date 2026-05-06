# `ctxharness populate` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ctxharness populate` command that reads an existing `.ctxharness.yml`, scans the declared files for heuristic claims, and suggests (or appends with `--apply`) new assertions for claims not already covered — bridging the UX gap between `init` (creates config from scratch) and maintaining a live config over time.

**Architecture:** New `packages/core/src/populate.ts` holds pure computation: claim→Assertion mapping and deduplication against existing IDs. The CLI command handles glob expansion (via `fast-glob`, already a dep), file scanning (reusing `scanFile` from `scan.ts`), and either pretty-printing proposed YAML or appending it to the config file.

**Tech Stack:** TypeScript strict ESM, `fast-glob` (already a dep), `detectClaims` / `scanFile` from `scan.ts`, `loadConfig` from `config.ts`, vitest.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/core/src/populate.ts` | `claimToAssertion`, `populateFromConfig`, `assertionsToYaml` |
| Create | `packages/core/src/__tests__/populate.test.ts` | Unit tests for the core module |
| Modify | `packages/core/src/index.ts` | Export `populateFromConfig`, `assertionsToYaml`, `PopulateResult` |
| Modify | `packages/cli/src/index.ts` | New `populate` command + add `HeuristicClaim` to type imports |
| Modify | `CHANGELOG.md` | v0.4.5 entry |
| Modify | `README.md` | `populate` section |
| Modify | `CLAUDE.md` | Key files table + test count + CLI command count |

---

### Task 1: Write failing tests for the core module

**Files:**
- Create: `packages/core/src/__tests__/populate.test.ts`

- [ ] **Step 1: Write the failing test file**

```typescript
import { describe, it, expect } from 'vitest'
import { populateFromConfig, assertionsToYaml } from '../populate.js'
import type { PopulateResult } from '../populate.js'
import type { CtxharnessConfig } from '../config.js'
import type { HeuristicClaim } from '../scan.js'

function makeConfig(assertionIds: string[] = []): CtxharnessConfig {
  return {
    version: 1,
    files: { include: ['CLAUDE.md'], exclude: ['node_modules/**'] },
    assertions: assertionIds.map((id) => ({
      id,
      extractor: 'nvmrc' as const,
      scanner: 'inlineRegex' as const,
      scannerArgs: { pattern: 'x' },
    })),
  }
}

function makeClaim(overrides: Partial<HeuristicClaim> = {}): HeuristicClaim {
  return {
    type: 'semver',
    raw: '22.14.0',
    value: '22.14.0',
    tech: 'node',
    line: 1,
    ...overrides,
  }
}

// ─── populateFromConfig ───────────────────────────────────────────────────────

describe('populateFromConfig', () => {
  it('returns empty suggested and skippedIds when no claims', () => {
    const result = populateFromConfig(makeConfig(), [])
    expect(result.suggested).toHaveLength(0)
    expect(result.skippedIds).toHaveLength(0)
  })

  it('maps a node semver claim → nvmrc extractor + inlineRegex scanner', () => {
    const claim = makeClaim({ type: 'semver', tech: 'node', value: '22.14.0' })
    const result = populateFromConfig(makeConfig(), [claim])
    expect(result.suggested).toHaveLength(1)
    const a = result.suggested[0]!
    expect(a.id).toBe('node-version')
    expect(a.extractor).toBe('nvmrc')
    expect(a.scanner).toBe('inlineRegex')
    const pattern = (a.scannerArgs as Record<string, string>)['pattern']!
    expect(pattern).toContain('Node')
  })

  it('maps a nodejs alias claim identically to node', () => {
    const claim = makeClaim({ type: 'semver', tech: 'nodejs', value: '20.0.0' })
    const result = populateFromConfig(makeConfig(), [claim])
    expect(result.suggested).toHaveLength(1)
    expect(result.suggested[0]!.id).toBe('node-version')
    expect(result.suggested[0]!.extractor).toBe('nvmrc')
  })

  it('maps a non-node semver claim → packageJson extractor', () => {
    const claim = makeClaim({ type: 'semver', tech: 'typescript', value: '5.8' })
    const result = populateFromConfig(makeConfig(), [claim])
    expect(result.suggested).toHaveLength(1)
    const a = result.suggested[0]!
    expect(a.id).toBe('typescript-version')
    expect(a.extractor).toBe('packageJson')
    expect((a.extractorArgs as Record<string, string>)['package']).toBe('typescript')
    expect(a.scanner).toBe('inlineRegex')
  })

  it('maps a path claim → fileExists extractor + literalInMd scanner', () => {
    const claim = makeClaim({ type: 'path', tech: '', raw: 'src/index.ts', value: 'src/index.ts' })
    const result = populateFromConfig(makeConfig(), [claim])
    expect(result.suggested).toHaveLength(1)
    const a = result.suggested[0]!
    expect(a.id).toBe('path-src-index-ts')
    expect(a.extractor).toBe('fileExists')
    expect((a.extractorArgs as Record<string, string>)['path']).toBe('src/index.ts')
    expect(a.scanner).toBe('literalInMd')
    expect((a.scannerArgs as Record<string, string>)['literal']).toBe('src/index.ts')
  })

  it('maps a script claim → packageScript extractor + literalInMd scanner', () => {
    const claim = makeClaim({ type: 'script', tech: 'pnpm', raw: 'pnpm run build', value: 'build' })
    const result = populateFromConfig(makeConfig(), [claim])
    expect(result.suggested).toHaveLength(1)
    const a = result.suggested[0]!
    expect(a.id).toBe('script-build')
    expect(a.extractor).toBe('packageScript')
    expect((a.extractorArgs as Record<string, string>)['script']).toBe('build')
    expect(a.scanner).toBe('literalInMd')
    expect((a.scannerArgs as Record<string, string>)['literal']).toBe('pnpm run build')
  })

  it('skips claim whose generated ID already exists in config.assertions', () => {
    const claim = makeClaim({ type: 'semver', tech: 'node', value: '22.0.0' })
    const result = populateFromConfig(makeConfig(['node-version']), [claim])
    expect(result.suggested).toHaveLength(0)
    expect(result.skippedIds).toContain('node-version')
  })

  it('deduplicates claims that produce the same ID — keeps only first', () => {
    const c1 = makeClaim({ type: 'semver', tech: 'node', value: '20.0.0', line: 1 })
    const c2 = makeClaim({ type: 'semver', tech: 'node', value: '22.0.0', line: 5 })
    const result = populateFromConfig(makeConfig(), [c1, c2])
    expect(result.suggested).toHaveLength(1)
  })

  it('handles multiple distinct claim types without cross-contamination', () => {
    const claims = [
      makeClaim({ type: 'semver', tech: 'node', value: '22.0.0' }),
      makeClaim({ type: 'path', tech: '', raw: './src', value: './src' }),
      makeClaim({ type: 'script', tech: 'pnpm', raw: 'pnpm test', value: 'test' }),
    ]
    const result = populateFromConfig(makeConfig(), claims)
    expect(result.suggested).toHaveLength(3)
    expect(result.suggested.map((a) => a.id)).toEqual(
      expect.arrayContaining(['node-version', 'path--src', 'script-test'])
    )
  })
})

// ─── assertionsToYaml ─────────────────────────────────────────────────────────

describe('assertionsToYaml', () => {
  it('returns empty string for empty array', () => {
    expect(assertionsToYaml([])).toBe('')
  })

  it('returns YAML with correct extractor and scanner for a node-version assertion', () => {
    const { suggested } = populateFromConfig(makeConfig(), [
      makeClaim({ type: 'semver', tech: 'node', value: '22.0.0' }),
    ])
    const yaml = assertionsToYaml(suggested)
    expect(yaml).toContain('id: node-version')
    expect(yaml).toContain('extractor: nvmrc')
    expect(yaml).toContain('scanner: inlineRegex')
    expect(yaml).toContain('scannerArgs:')
  })

  it('each assertion block starts with "  - id:" (2-space indent for YAML list)', () => {
    const { suggested } = populateFromConfig(makeConfig(), [
      makeClaim({ type: 'semver', tech: 'node', value: '22.0.0' }),
    ])
    const yaml = assertionsToYaml(suggested)
    const firstLine = yaml.split('\n')[0]!
    expect(firstLine).toMatch(/^  - id:/)
  })

  it('serialises extractorArgs when present', () => {
    const { suggested } = populateFromConfig(makeConfig(), [
      makeClaim({ type: 'semver', tech: 'typescript', value: '5.8' }),
    ])
    const yaml = assertionsToYaml(suggested)
    expect(yaml).toContain('extractorArgs:')
    expect(yaml).toContain("package: 'typescript'")
  })

  it('serialises two assertions separated by a blank line', () => {
    const claims = [
      makeClaim({ type: 'semver', tech: 'node', value: '22.0.0' }),
      makeClaim({ type: 'semver', tech: 'typescript', value: '5.8' }),
    ]
    const { suggested } = populateFromConfig(makeConfig(), claims)
    const yaml = assertionsToYaml(suggested)
    // Should contain two id: blocks
    const idCount = (yaml.match(/^\s+- id:/gm) ?? []).length
    expect(idCount).toBe(2)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/florianbruniaux/Sites/perso/ctxharness
rtk vitest run packages/core/src/__tests__/populate.test.ts
```

Expected: FAIL — `Cannot find module '../populate.js'`

- [ ] **Step 3: Commit failing tests**

```bash
git add packages/core/src/__tests__/populate.test.ts
git commit -m "test(populate): add failing tests for populate core module"
```

---

### Task 2: Implement the core module

**Files:**
- Create: `packages/core/src/populate.ts`

- [ ] **Step 1: Create the implementation**

```typescript
import type { Assertion, CtxharnessConfig } from './config.js'
import type { HeuristicClaim } from './scan.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PopulateResult {
  suggested: Assertion[]
  skippedIds: string[]
}

// ─── Internals ────────────────────────────────────────────────────────────────

function claimId(claim: HeuristicClaim): string {
  if (claim.type === 'semver') {
    const tech = claim.tech === 'nodejs' ? 'node' : claim.tech
    return `${tech}-version`
  }
  if (claim.type === 'path') {
    const safe = claim.value.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    return `path-${safe}`
  }
  const safe = claim.value.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return `script-${safe}`
}

function claimToAssertion(claim: HeuristicClaim): Assertion {
  if (claim.type === 'semver') {
    const tech = claim.tech === 'nodejs' ? 'node' : claim.tech
    if (tech === 'node') {
      return {
        id: 'node-version',
        extractor: 'nvmrc',
        scanner: 'inlineRegex',
        scannerArgs: { pattern: 'Node(?:\\.js)?\\s+v?(\\d+(?:\\.\\d+(?:\\.\\d+)?)?)' },
      }
    }
    return {
      id: `${tech}-version`,
      extractor: 'packageJson',
      extractorArgs: { package: tech },
      scanner: 'inlineRegex',
      scannerArgs: { pattern: `${tech}\\s+v?(\\d+(?:\\.\\d+(?:\\.\\d+)?)?)` },
    }
  }

  if (claim.type === 'path') {
    const safe = claim.value.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    return {
      id: `path-${safe}`,
      extractor: 'fileExists',
      extractorArgs: { path: claim.value },
      scanner: 'literalInMd',
      scannerArgs: { literal: claim.value },
    }
  }

  // script
  const safe = claim.value.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return {
    id: `script-${safe}`,
    extractor: 'packageScript',
    extractorArgs: { script: claim.value },
    scanner: 'literalInMd',
    scannerArgs: { literal: claim.raw },
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Given an existing config and a list of detected claims, returns the subset
 * of claims that map to assertion IDs not already present in config.assertions.
 * Deduplicates claims that map to the same ID.
 */
export function populateFromConfig(
  config: CtxharnessConfig,
  claims: HeuristicClaim[],
): PopulateResult {
  const existingIds = new Set(config.assertions.map((a) => a.id))
  const seenIds = new Set<string>(existingIds)
  const suggested: Assertion[] = []
  const skippedIds: string[] = []

  for (const claim of claims) {
    const id = claimId(claim)
    if (existingIds.has(id) && !skippedIds.includes(id)) {
      skippedIds.push(id)
      continue
    }
    if (seenIds.has(id)) continue
    seenIds.add(id)
    suggested.push(claimToAssertion(claim))
  }

  return { suggested, skippedIds }
}

// ─── YAML serialiser ──────────────────────────────────────────────────────────

function yamlQ(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/**
 * Serialise an array of Assertions as YAML lines ready to append under
 * an existing `assertions:` key (each item indented with 2 spaces).
 */
export function assertionsToYaml(assertions: Assertion[]): string {
  if (assertions.length === 0) return ''

  const lines: string[] = []
  for (const a of assertions) {
    lines.push(`  - id: ${a.id}`)
    lines.push(`    extractor: ${a.extractor}`)
    if (a.extractorArgs !== undefined && Object.keys(a.extractorArgs).length > 0) {
      lines.push(`    extractorArgs:`)
      for (const [k, v] of Object.entries(a.extractorArgs)) {
        lines.push(`      ${k}: ${yamlQ(String(v))}`)
      }
    }
    lines.push(`    scanner: ${a.scanner}`)
    if (a.scannerArgs !== undefined && Object.keys(a.scannerArgs).length > 0) {
      lines.push(`    scannerArgs:`)
      for (const [k, v] of Object.entries(a.scannerArgs)) {
        lines.push(`      ${k}: ${yamlQ(String(v))}`)
      }
    }
  }

  return lines.join('\n')
}
```

- [ ] **Step 2: Run the populate tests**

```bash
rtk vitest run packages/core/src/__tests__/populate.test.ts
```

Expected: All tests PASS.

- [ ] **Step 3: Run full suite to confirm no regressions**

```bash
rtk vitest run
```

Expected: All tests pass (was 186 before, now 200+).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/populate.ts
git commit -m "feat(populate): implement populateFromConfig and assertionsToYaml"
```

---

### Task 3: Export from core `index.ts`

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add exports after the trend line**

In `packages/core/src/index.ts`, add:

```typescript
export { populateFromConfig, assertionsToYaml } from './populate.js'
export type { PopulateResult } from './populate.js'
```

- [ ] **Step 2: Build to verify**

```bash
pnpm build
```

Expected: 0 TypeScript errors, `dist/index.d.ts` contains `populateFromConfig`.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(populate): export populateFromConfig and assertionsToYaml from core"
```

---

### Task 4: CLI `populate` command

**Files:**
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Update the static import line**

Replace the existing import line at the top of `packages/cli/src/index.ts`:

```typescript
// Before:
import { loadConfig, run, report, buildSnapshot, saveSnapshot, loadSnapshot, findLatestSnapshot, diffSnapshots, scanFile, detectIncludes, appendTrendRecord } from '@florianbruniaux/ctxharness-core'
import type { OutputFormat, AssertionResult, HeuristicResult, TrendRecord, RunResult } from '@florianbruniaux/ctxharness-core'

// After:
import { loadConfig, run, report, buildSnapshot, saveSnapshot, loadSnapshot, findLatestSnapshot, diffSnapshots, scanFile, detectIncludes, appendTrendRecord, populateFromConfig, assertionsToYaml } from '@florianbruniaux/ctxharness-core'
import type { OutputFormat, AssertionResult, HeuristicResult, HeuristicClaim, TrendRecord, RunResult } from '@florianbruniaux/ctxharness-core'
```

- [ ] **Step 2: Add the `populate` command before `program.parse()`**

Insert the following block after the `trend` command and before `program.parse()`:

```typescript
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
      const { default: fg } = await import('fast-glob')
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
        console.log(chalk.dim(`  files.include: ${config.files.include.join(', ')}\n`))
        process.exit(0)
      }

      // Extract claims from all declared files
      const allClaims: HeuristicClaim[] = []
      for (const filePath of expandedFiles) {
        try {
          const results = scanFile(filePath, root)
          for (const r of results) allClaims.push(r.claim)
        } catch {
          // skip unreadable file
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

      // Apply: append to the config file
      const existing = readFileSync(configPath, 'utf-8')
      const updated = existing.trimEnd() + '\n  # added by ctxharness populate\n' + yamlBlock + '\n'
      writeFileSync(configPath, updated, 'utf-8')

      console.log(chalk.green(`\n✓ Appended ${suggested.length} assertion${suggested.length !== 1 ? 's' : ''} to ${opts.config}\n`))
      console.log(chalk.dim(`  Run \`ctxharness run\` to enforce them.\n`))
      process.exit(0)
    } catch (e) {
      process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`)
      process.exit(1)
    }
  })
```

- [ ] **Step 3: Build**

```bash
pnpm build
```

Expected: 0 TypeScript errors.

- [ ] **Step 4: Smoke test (dry-run) against the ctxharness repo itself**

```bash
node packages/cli/dist/index.js populate -c .ctxharness.yml
```

Expected: Either "All detected claims are already covered" or a YAML proposal (not an error).

- [ ] **Step 5: Run full test suite**

```bash
rtk vitest run
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(populate): add populate CLI command with dry-run and --apply modes"
```

---

### Task 5: Docs + version bump to v0.4.5

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `packages/core/package.json` (version: 0.4.4 → 0.4.5)
- Modify: `packages/cli/package.json` (version: 0.4.4 → 0.4.5)
- Modify: `packages/cli/src/index.ts` (version string 0.4.4 → 0.4.5)

- [ ] **Step 1: Prepend the CHANGELOG entry**

Add at the top of `CHANGELOG.md` (after the `# Changelog` heading):

```markdown
## [0.4.5] — 2026-05-06

### Added

- `populate` command: reads your existing `.ctxharness.yml`, scans the declared files for heuristic claims, and suggests (or appends with `--apply`) new assertions for claims not yet covered. Bridges the gap between `init` (creates config from scratch) and keeping the config current as your AI docs evolve.
```

- [ ] **Step 2: Add `populate` to the README**

In `README.md`, add `populate` to the CLI commands list and add a `### populate` section. After the `### Trend history` section, add:

````markdown
### populate

Scan your already-declared files for verifiable claims (semver, paths, scripts) and suggest assertions for any claims not yet in your config.

```bash
# Dry-run (default): preview what would be added
ctxharness populate

# Write changes to .ctxharness.yml
ctxharness populate --apply
```

Typical workflow: run `ctxharness init` once to bootstrap the config, then run `ctxharness populate --apply` any time you update your AI docs and want to capture new claims.
````

- [ ] **Step 3: Update `CLAUDE.md`**

In the key files table, add:

```
| `packages/core/src/populate.ts` | `populateFromConfig` + `assertionsToYaml` — claim→Assertion mapping |
```

Update the roadmap counts:
- `11 CLI commands` (was 10)
- test count from 186 to the new actual count (run `rtk vitest run` to get the exact number)
- Version to `v0.4.5`

- [ ] **Step 4: Bump versions**

In `packages/core/package.json`:
```json
"version": "0.4.5",
```

In `packages/cli/package.json`:
```json
"version": "0.4.5",
```

In `packages/cli/src/index.ts`, line `.version('0.4.4')`:
```typescript
.version('0.4.5')
```

- [ ] **Step 5: Build + full test pass**

```bash
pnpm build && rtk vitest run
```

Expected: 0 errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md README.md CLAUDE.md packages/core/package.json packages/cli/package.json packages/cli/src/index.ts
git commit -m "chore: release v0.4.5 — populate command"
```

---

## Self-review against spec

**Spec requirements covered:**
- [x] Reads existing `.ctxharness.yml` → `loadConfig(configPath)`
- [x] Scans declared files (`files.include`) → `fast-glob` expansion + `scanFile`
- [x] Generates assertions for uncovered claims → `populateFromConfig`
- [x] Dry-run by default, prints YAML → default behavior
- [x] `--apply` writes to config → `readFileSync` + append + `writeFileSync`
- [x] Deduplicates against existing assertion IDs → `seenIds` set
- [x] Reports already-covered claims → `skippedIds`

**No placeholders:** All code blocks are complete and runnable.

**Type consistency:** `HeuristicClaim` imported from `scan.ts` matches what `scanFile` returns (`.claim` field on `HeuristicResult`). `Assertion` from `config.ts` matches what `populateFromConfig` returns. `assertionsToYaml` takes `Assertion[]` throughout.
