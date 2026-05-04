# Changelog

All notable changes to ctxharness are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) — semver.

---

## [Unreleased]

### Added

- `constant` extractor — returns a fixed value; placeholder for quality scanners that define their threshold via `scannerArgs`
- `vaguenessPattern` scanner — detects vague AI instruction language ("be careful", "as needed", "use your judgment", etc.), extensible via `scannerArgs.patterns`
- `negativeConstraintDensity` scanner — checks positive:negative instruction ratio meets a minimum threshold (`scannerArgs.minRatio`, default 1.0)
- 9 new vitest tests (40 total)

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
