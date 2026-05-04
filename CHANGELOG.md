# Changelog

All notable changes to ctxharness are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) — semver.

---

## [Unreleased]

### Added

- `constant` extractor — returns a fixed value; placeholder for quality scanners that define their threshold via `scannerArgs`
- `vaguenessPattern` scanner — detects vague AI instruction language ("be careful", "as needed", "use your judgment", etc.), extensible via `scannerArgs.patterns`
- `negativeConstraintDensity` scanner — checks positive:negative instruction ratio meets a minimum threshold (`scannerArgs.minRatio`, default 1.0)
- `contextBudget` scanner — estimates token footprint of a file (chars ÷ 4), fails if above `scannerArgs.maxTokens` (default 3000); designed for `.claude/rules/**/*.md` and `CLAUDE.md`
- `ruleGlobValidity` scanner — validates that Claude Code rules files have YAML frontmatter; with `requirePaths: true`, also enforces the presence of a `paths:` field for contextual loading
- 3 new rule fixtures: `rule-with-paths.md`, `rule-no-frontmatter.md`, `rule-frontmatter-no-paths.md`
- 10 new vitest tests (50 total)
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
