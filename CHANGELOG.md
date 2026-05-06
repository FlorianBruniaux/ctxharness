# Changelog

All notable changes to ctxharness are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) — semver.

---

## [Unreleased]

---

## [0.4.5] — 2026-05-06

### Added

- `populate` command: reads your existing `.ctxharness.yml`, scans the declared files for heuristic claims, and suggests (or appends with `--apply`) new assertions for claims not yet covered. Bridges the gap between `init` (creates config from scratch) and keeping the config current as your AI docs evolve.
- `init` now auto-scans existing AI doc files (CLAUDE.md, AGENTS.md, .cursorrules) and generates assertions from detected claims — no more editing a generic template by hand
- `scan` shows a tip at the bottom suggesting `--suggest-config` or `ctxharness init` when no config file exists
- `scan` shows a tip when `.ctxharness.yml` already exists, clarifying that `scan` is single-file discovery while `run` enforces all configured files

---

## [0.4.4] — 2026-05-06

### Added

- `trend` command — cross-run drift score history with sparkline, direction detection (improving/worsening/flat), and per-run table
- Auto-recording to `~/.ctxharness/history.jsonl` after every `run`, `check`, `score`, and `doctor` run
- `--no-trend` flag on `run`, `check`, `score`, and `doctor` to skip recording (useful in CI)

---

## [0.4.3] — 2026-05-06

### Added

- `hookValidity` scanner now warns (`status: warn`) when a hook command in `.claude/settings.json` contains an absolute path (`/Users/`, `/home/`, `/root/`, etc.) — breaks portability across machines; use relative paths instead

### Fixed

- `.claude/settings.json` hook commands now use relative paths (`.claude/hooks/...`) instead of hardcoded absolute machine-specific paths

---

## [0.4.2] — 2026-05-06

### Added

- `scan` now follows `@file.md` includes (Claude/Gemini/Cursor convention) up to depth 3 — claims in included files are now detected and verified
- `detectIncludes` exported from `@florianbruniaux/ctxharness-core` for programmatic access to include references

### Fixed

- "No verifiable claims found" message now clarifies which included files were also scanned when the target file only contains `@include` references — no longer looks like the scan stopped early

---

## [0.4.1] — 2026-05-05

### Added

- `--exit-zero` flag on `scan` — always exits 0 even when drifts are found; designed for Husky hooks and warning-only CI steps where you want visibility without blocking

### Fixed

- `scan` no longer detects Claude Code slash commands (`/plan`, `/ship`, `/tech:commit`) as file path claims
- `scan` no longer detects URL route patterns without a file extension (`/api/chunk`, `/about/`, `/devs/atlas`) as file path claims
- `scan` no longer detects template placeholder patterns (`{slug}`, `{PR_NUMBER}`, `[owner]`, `<pkgname>`) as file path claims

---

## [0.4.0] — 2026-05-05

### Added

- `scan` command — zero-config heuristic scan of any markdown file; detects semver versions, file paths, and npm scripts in backtick-wrapped text; auto-maps each claim to the right extractor; reports match/drift in a human-readable table
- `--suggest-config` flag on `scan` — generates a starter `.ctxharness.yml` based on detected claims
- `detectClaims`, `verifyClaim`, `scanFile` exported from `@florianbruniaux/ctxharness-core` for programmatic use
- `packageScript` extractor — detects whether an npm script exists in `package.json`, enabling validation of script references in AI instruction files

---

## [0.2.0] — 2026-05-05

### Fixed

- `cargoToml` extractor now supports Cargo workspaces — falls back to `[workspace.package].version` when `[package].version` is absent, and searches `[workspace.dependencies]` in addition to `[dependencies]`, `[dev-dependencies]`, and `[build-dependencies]`

### Added

- `warn` status — `ScanResult` and `AssertionResult` now support `'warn'`; `RunResult` gains `totalWarn`; warn earns 50% of score weight in `computeScore`; reporter shows `⚠ N warn` in yellow
- `note` field on `ScanResult` — optional contextual message shown indented below the mismatch row in text output
- `freshnessScore` scanner — interprets `gitStaleness` commit count; `pass` if commits <= `warnAfter` (default 30), `warn` if <= `failAfter` (default 100), `fail` otherwise
- `prismaModelList` extractor — same as `prismaModel` but returns a JSON array of model names instead of a count; args: `path`
- `trpcRouterList` extractor — same as `trpcRouter` but returns a JSON array of router key names instead of a count; args: `path`
- `coverageRatio` scanner — checks what fraction of a JSON array (from `prismaModelList`/`trpcRouterList`) appears in the file; args: `minRatio` (default 0.8), `valueAllowlist`
- `valueAllowlist` field on assertions — merged with `scannerArgs.valueAllowlist` before calling `coverageRatio`; entity names to skip from coverage computation
- `generatedFrom` field on `files` config — map from file path fragment to source path; files matching are annotated with `generated file — fix in: <source>` note on fail results
- Generated-file detection in runner — first 5 lines of scanned files are checked for `/generated/i`, `/@generated/`, `/DO NOT EDIT/i`, `/auto-generated/i` markers
- `ctxharness snapshot` CLI command — runs all assertions and saves result to `.ctxharness/snapshots/{timestamp}.json` with score and grade
- `ctxharness diff [baseline]` CLI command — compares current run against a saved snapshot; shows score delta, grade change, and per-assertion status changes; exits 1 on score regression

- `constant` extractor — returns a fixed value; placeholder for quality scanners that define their threshold via `scannerArgs`
- `vaguenessPattern` scanner — detects vague AI instruction language ("be careful", "as needed", "use your judgment", etc.), extensible via `scannerArgs.patterns`
- `negativeConstraintDensity` scanner — checks positive:negative instruction ratio meets a minimum threshold (`scannerArgs.minRatio`, default 1.0)
- `contextBudget` scanner — estimates token footprint of a file (chars ÷ 4), fails if above `scannerArgs.maxTokens` (default 3000); designed for `.claude/rules/**/*.md` and `CLAUDE.md`
- `contextBudget` now supports `followImports: true` — resolves `@file.md` chains (up to depth 3) and includes their sizes in the token estimate, making CLAUDE.md budget checks accurate when @-imports are used
- `ruleGlobValidity` scanner — validates that Claude Code rules files have YAML frontmatter; with `requirePaths: true`, also enforces the presence of a `paths:` field for contextual loading
- `prismaModel` extractor — counts `model X {}` blocks in a Prisma schema file; args: `path`
- `prismaEnum` extractor — counts values in a named Prisma enum block; args: `path`, `enum`
- `trpcRouter` extractor — counts registered router entries in a tRPC root file; args: `path`
- `gitStaleness` extractor — counts commits made since a file was last changed; args: `path`; "0" means up-to-date; requires a git repository
- `packageEngines` extractor — reads a version from the `engines` map in `package.json`; args: `field` (default "node"); strips semver operators (`>=22.0.0` → `22.0.0`)
- `tsconfigPaths` extractor — counts path aliases in `tsconfig.json` `compilerOptions.paths`; args: `path` (default "tsconfig.json"); JSONC-aware (strips `//` comments)
- `hookValidity` scanner — validates Claude Code `settings.json` hook entries (matcher non-empty, hooks array non-empty, command present); L3 context assembly
- `backtickEntityPresence` scanner — checks that a named entity appears as `` `entity` `` (inline code) in the doc; args: `entity`
- `skillValidity` scanner — validates `.claude/skills/` files have YAML frontmatter with `name:` and `description:`; args: `requireDescription` (default true)
- `allowlist` field on assertions — list of file path patterns to skip from fail results (marks them `skip`); useful to suppress known-intentional gaps in legacy files (e.g. `CHANGELOG.md`)
- `ctxharness score` CLI command — runs all assertions and reports a 0–100 health score with grade (S/A/B/C/D/F); `pass` and `skip` earn full weight, `fail`/`error`/`no-mention` score 0
- `ctxharness fix` CLI command — auto-fixes version drift in AI doc files; dry-run by default, `--apply` writes changes; replaces wrong version on the exact matched line
- `ctxharness doctor` CLI command — comprehensive health check; categorizes assertions by L1/L2/L3, shows score, lists all issues with location, and recommends remediation
- `--watch` / `-w` flag on `ctxharness run` — re-runs assertions on file changes using `fs.watch` with `recursive: true`; 300ms debounce
- Plugin API (`definePlugin`, `loadPlugin`, `registerExtractor`, `registerScanner`) — extend ctxharness with custom extractors and scanners programmatically
- GitLab CI template: `templates/ci/gitlab-ci.yml`
- CircleCI template: `templates/ci/circleci.yml`
- Stack preset — T3 (Next.js + Prisma + tRPC): `templates/presets/t3.yml`
- Stack preset — Next.js App Router: `templates/presets/next-app-router.yml`
- `skip` status in `ScanResult` and `AssertionResult` — allowlisted failures render as `~ N skipped` in the text reporter
- `totalSkip` field in `RunResult`
- 3 new rule fixtures: `rule-with-paths.md`, `rule-no-frontmatter.md`, `rule-frontmatter-no-paths.md`
- 7 new test fixtures: `trpc-root.ts`, `claude-with-imports.md`, `imported-rule.md`, plus model + enum blocks in `schema.prisma`, `settings-valid.json`, `settings-invalid-hook.json`
- 31 new vitest tests (71 total)
- `.claude/skills/eval-rules/` — interactive audit of `.claude/rules/` glob patterns and relevance
- `.claude/skills/eval-skills/` — scored quality audit of all skills in `.claude/skills/`
- `.claude/skills/token-audit/` — context token overhead measurement with prioritized action plan
- `.claude/commands/audit-docs.md` — 30-criteria documentation quality audit with optional file generation

---

## [0.1.0] — 2026-05-01

### Added

- `@ctxharness/core` — config schema (Zod + YAML), 6 extractors, 6 scanners, runner, reporter
- `ctxharness` CLI — `run`, `check`, `init` commands (commander)
- Output formats: `text` (terminal table), `json`, `gha` (GitHub Actions annotations)
- Version normalization: partial mentions (`v22`) match full versions (`22.14.0`)
- GitHub Action wrapper (`action.yml`) with `drift-detected` output
- Husky templates: `post-merge`, `post-checkout`
- CI template: `.github/workflows/ctxharness.yml`
- 31 vitest tests across extractors, scanners, runner

### Extractors

`packageJson`, `packageManager`, `nvmrc`, `fileExists`, `regexScan`, `countMatches`

### Scanners

`inlineRegex`, `codeBlockRegex`, `yamlField`, `jsonField`, `literalInMd`, `pathReference`
