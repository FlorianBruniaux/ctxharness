# ctxharness — Roadmap & Positioning Design

**Date**: 2026-05-05
**Status**: Approved
**Horizon**: v0.3 → v0.5

---

## Context

ctxharness is at v0.2.1 with a solid foundation: 19 extractors, 15 scanners, 8 CLI commands, plugin API. It's been released on npm (`ctxharness` + `@florianbruniaux/ctxharness-core`).

**Goal priority**: OSS credibility/visibility → internal use (Aristote, etc.) → external adoption.

**The strategic insight**: The competitive landscape is fragmented across 4 distinct jobs (compile, lint structure, distribute, syntax-check). No tool occupies the slot "are the factual claims in your AI docs currently true?" — that's ctxharness's unique position.

**The friction problem**: ctxharness requires a `.ctxharness.yml` before delivering first value. This is the primary barrier to adoption. The aha moment is hidden behind configuration.

---

## Competitive Landscape

| Tool | Job | Philosophy |
|------|-----|-----------|
| vigiles | TypeScript spec → CLAUDE.md compiler | "Markdown can't be validated. TypeScript can." |
| AgentLint | Whole-harness structural linter | "ESLint for your agent harness" |
| Ruler / rulesync / rule-porter | Rule distribution & sync | Single source → multiple agents |
| cclint / cursor-doctor | Syntax/format validation | Is the file well-formed? |
| **ctxharness** | **Factual claim verification** | **Are the claims in your AI docs true?** |

ctxharness does not compete with any of these. It validates what they distribute, compile, or structure.

---

## Positioning Statement

> ctxharness is the only tool that checks whether the factual claims in your AI instruction files are currently true — versions, file paths, commands, counts — across every major ecosystem (Node.js, Python, Go, Rust).

**Not**: a linter, a compiler, a distribution tool.
**But**: a fact-checker for your agent context.

---

## Phases

### Phase 0 — Spike: Validate approach B *(2 days max, go/no-go)*

**Question**: Can heuristic claim detection work well enough to power a "zero-config wow demo"?

**Method**:
1. Collect 10 public CLAUDE.md files from diverse real repos
2. Implement minimal claim detector — 3 patterns only:
   - Semver in backticks: `` `X.Y.Z` `` near tech keywords
   - File paths in backticks: `` `src/...` ``, `` `./...` ``
   - npm scripts in backticks: `` `npm run X` ``
3. For each detected claim: can ctxharness auto-map it to an extractor?
4. Measure: claims detected, verifiable, false positive rate

**Decision gate**:
- False positive rate < 20% → Approach B viable → proceed to Phase 2
- False positive rate ≥ 20% → Abandon B → jump directly to Phase 3 (distribution)

**Out**: a 1-page spike report with numbers. No code merged until gate passes.

---

### Phase 1 — Quick Win: `packageScript` extractor *(v0.3, ~1 week)*

**Problem**: vigiles identified a gap ctxharness doesn't fill — if your CLAUDE.md says "run `npm run typecheck`" and that script was deleted from `package.json`, nothing catches it.

**Solution**: `packageScript` extractor
- Reads `scripts` field from `package.json`
- Returns `"true"` if script exists, `"false"` if not (like `fileExists`)
- Used with `literalInMd` scanner to detect stale script references

**Usage**:
```yaml
- id: typecheck-script-exists
  extractor: packageScript
  extractorArgs:
    script: typecheck
  scanner: literalInMd
  scannerArgs:
    literal: "npm run typecheck"
```

**Implementation scope**:
- `packages/core/src/extractors/index.ts` — add `packageScript` function
- `packages/core/src/config.ts` — add to `ExtractorNameSchema`
- `packages/core/src/__tests__/extractors.test.ts` — add fixture + test
- `packages/core/src/__tests__/fixtures/` — add `package-with-scripts.json`
- `README.md` — add to extractor table
- `CHANGELOG.md` — update Unreleased

**Validation**: `ctxharness run` on a project where `npm run typecheck` appears in CLAUDE.md but the script is absent from `package.json` → status `fail`.

**Rollback**: `git revert` + patch publish in < 10 min.

---

### Phase 2 — Zero-Config Scan *(v0.4, ~2-3 weeks — only if Phase 0 go)*

**Problem**: first-value requires a `.ctxharness.yml`. New users see a config file requirement before they see any output.

**Solution**: `ctxharness scan [file]` command — no config required.

**Behavior**:
1. Parse target file (default: `CLAUDE.md`)
2. Auto-detect claims in 3 categories: semver versions, file paths, npm scripts
3. For each claim: auto-select the appropriate extractor, run it, report match/mismatch
4. Output: human-readable report (same format as `run`) + optional `--suggest-config` flag that prints a starter `.ctxharness.yml`

**UX**:
```
$ npx ctxharness scan CLAUDE.md

Scanning CLAUDE.md for verifiable claims...

claim                   detected        actual          status
────────────────────────────────────────────────────────────────
next                    16.2.0          16.3.1          ✗ drift
node                    22.0.0          22.14.0         ✓ match
src/utils/auth.ts       mentioned       exists          ✓ match
npm run typecheck       mentioned       NOT in scripts  ✗ drift
────────────────────────────────────────────────────────────────
✗ 2 drifts found

Run `ctxharness scan --suggest-config` to generate a .ctxharness.yml
```

**`ctxharness init` improvement**: if no `.ctxharness.yml` exists, run scan first and offer the suggested config as the starting point.

**Scope** (after Phase 0 spike validates approach):
- New `scan` command in `packages/cli/src/index.ts`
- Heuristic claim detector in `packages/core/src/scan.ts` (new file)
- Auto-mapper: claim type → extractor
- `--suggest-config` flag generating YAML output
- Tests on ≥ 5 fixture CLAUDE.md files
- README update: add `scan` to CLI section

**Success criteria**:
- On 5 public repos, `ctxharness scan CLAUDE.md` returns ≥ 1 real drift with < 2 false positives
- 1 external share (HN, X, newsletter) generates ≥ 50 reactions within 48h of launch

---

### Phase 3 — Distribution Ecosystem *(v0.5, triggered by traction)*

**Trigger**: proceed when ctxharness has ≥ 200 GitHub stars OR is used on ≥ 3 external projects (verified via issues/discussions).

**Features**:

**Preset packages** (vibe-rules pattern):
- Separate npm packages: `ctxharness-preset-t3`, `ctxharness-preset-next`, etc.
- `ctxharness preset add <name>` command merges preset into local `.ctxharness.yml`
- Enables teams to share validated config across repos

**VSCode extension** (already planned for v0.5):
- Inline diagnostics on CLAUDE.md (underline stale version)
- Status bar health score
- Runs on save

**Positioning play**:
- "Use Ruler to distribute your AI docs. Use ctxharness to verify them."
- Not a deep integration — just clear messaging that positions ctxharness as the validation layer in the distribution ecosystem.

---

## Out of Scope (explicitly deferred)

| Feature | Reason |
|---------|--------|
| `linterRuleEnabled` scanner | vigiles territory — requires parsing ESLint/Ruff/Clippy configs, weeks of work, disproportionate to value |
| `envVarPresence` extractor | `.env` is gitignored, `.env.example` rots too, validation of a partial truth |
| Ruler/rulesync deep integration | Ecosystem too small today (Ruler ~50 stars), revisit at Phase 3 |
| `lostInMiddle` scanner | Interesting hypothesis (ETH Zurich research), causal link not proven, defer until v1.0 |
| GitHub App (Dependabot-style) | v1.0+ |
| Monorepo / multi-root | Already planned for v1.0 |

---

## Success Metrics

| Milestone | Criteria |
|-----------|---------|
| v0.3 shipped | `packageScript` detects a deleted script on a real project |
| Phase 0 go | False positive rate < 20% on 10 public CLAUDE.md files |
| v0.4 launch | 1 external share → ≥ 50 reactions in 48h |
| Phase 3 trigger | ≥ 200 GitHub stars OR ≥ 3 verified external users |

---

## What ctxharness Is NOT

To prevent scope drift:
- Not a rule distribution tool (Ruler does this)
- Not a TypeScript spec compiler (vigiles does this)
- Not a behavioral drift detector (PromptDrifter does this)
- Not a structural linter (AgentLint does this)

ctxharness verifies factual accuracy. Everything else is out of scope.
