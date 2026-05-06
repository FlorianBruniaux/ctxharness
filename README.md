# ctxharness

**AI documentation drift detection for teams using Claude Code, Cursor, Copilot, and any agent-driven workflow.**

Your `CLAUDE.md` says the auth config lives at `src/config/auth.ts`. That file moved to `src/modules/auth/config.ts` six months ago. Your agent tries to import from a path that no longer exists, silently, on every session.

Or: `CLAUDE.md` says `npm run typecheck`. The script was renamed to `npm run type-check` during a cleanup sprint. The agent runs a command that doesn't exist.

ctxharness catches this before it reaches your agents.

```bash
npx ctxharness scan CLAUDE.md   # zero-config — detect drift instantly
# or, with full config:
npx ctxharness init              # scaffold .ctxharness.yml
npx ctxharness run               # check all assertions
```

## Why put facts in CLAUDE.md at all?

Agents work from the context window. Pointing an agent to `package.json` works, but it means reading that file on every session, and many facts can't be read from a single source file: architectural patterns, team conventions, file locations, which ORM you're using and why. ctxharness is for facts you've already decided to state explicitly. It keeps those statements accurate.

## What it checks

**L1 — Fact drift**: file existence, npm scripts, versions, counts, regex captures — any extractable fact from your codebase vs what your AI docs claim.

**L2 — Instruction quality**: vague language that degrades agent reliability ("be careful", "use your judgment"), positive/negative instruction ratio, multi-file coherence, token budget.

**L3 — Context assembly**: hook validation, skill loading, rule glob validity, coverage ratio.

**No migration needed.** Works on your existing CLAUDE.md, AGENTS.md, and .cursorrules files as-is.

## Install

**npm/pnpm (Node.js projects):**

```bash
npm install -g ctxharness
# or
pnpm add -D ctxharness
```

> **Standalone binary** for Python, Go, Rust and other non-Node projects: planned for v1.0.

## Quick start

```bash
ctxharness init          # creates .ctxharness.yml
ctxharness doctor        # full health check with L1/L2/L3 breakdown
```

Example output:

```
AI Context Test — 5 assertions

fact                    expected       mentions  status
────────────────────────────────────────────────────────────────────────
auth-config-path        true                  1  ✗ 1 mismatch
typecheck-script        true                  1  ✗ 1 mismatch
node-version            22.14.0               1  ✓ 1/1 pass
no-vague-language       check                 2  ✓ 2/2 pass
instruction-balance     check                 2  ✓ 2/2 pass
────────────────────────────────────────────────────────────────────────

Mismatches
────────────────────────────────────────────────────────────────────────
auth-config-path        CLAUDE.md:18   true        false
typecheck-script        CLAUDE.md:34   true        false
────────────────────────────────────────────────────────────────────────
✗ 2 mismatch(es) — update the file(s) listed above
```

## Configuration

`.ctxharness.yml` — minimal starter (one assertion per layer):

```yaml
version: 1

files:
  include:
    - 'CLAUDE.md'
    - 'AGENTS.md'
    - '.cursorrules'
  exclude:
    - 'node_modules/**'

assertions:
  # L1 — fact drift: auth config path still exists
  - id: auth-config-path
    extractor: fileExists
    extractorArgs:
      path: src/modules/auth/config.ts
    scanner: literalInMd

  # L1 — fact drift: typecheck script matches package.json
  - id: typecheck-script
    extractor: packageScript
    extractorArgs:
      script: type-check
    scanner: literalInMd

  # L2 — instruction quality: no vague language
  - id: no-vague-language
    extractor: constant
    extractorArgs:
      value: check
    scanner: vaguenessPattern

  # L3 — context assembly: hooks are valid
  - id: hook-validity
    extractor: constant
    extractorArgs:
      value: check
    scanner: hookValidity
```

<details>
<summary>Advanced config — allowlist, scopeFiles, multi-version assertions</summary>

```yaml
assertions:
  # allowlist: skip known-intentional mismatches in specific files
  - id: next-version
    extractor: packageJson
    extractorArgs:
      package: next
    scanner: inlineRegex
    scannerArgs:
      pattern: 'Next\.js\s+v?(\d+(?:\.\d+(?:\.\d+)?)?)'
    allowlist:
      - CHANGELOG.md   # version history file — intentional old values

  # scopeFiles: restrict an assertion to a subset of files
  - id: instruction-balance
    extractor: constant
    extractorArgs:
      value: check
    scanner: negativeConstraintDensity
    scannerArgs:
      minRatio: 2.0
    scopeFiles:
      include:
        - 'CLAUDE.md'
        - 'AGENTS.md'
      exclude:
        - '.cursorrules'   # constraint-only file by design
```

</details>

## Extractors

Read ground truth from your codebase. Common ones: `fileExists`, `packageScript`, `packageJson`, `nvmrc`, `gitStaleness`, `prismaModelList`, `goMod`, `cargoToml`.

<details>
<summary>Full extractor list (20)</summary>

| Name | What it reads | Args |
|------|--------------|------|
| `packageJson` | `dependencies`/`devDependencies` version | `package: string` |
| `packageManager` | `packageManager` field (strips corepack hash) | — |
| `nvmrc` | `.nvmrc` file | — |
| `fileExists` | Whether a path exists (`"true"`/`"false"`) | `path: string` |
| `regexScan` | Capture group from any file | `path`, `pattern`, `group?` |
| `countMatches` | Count of pattern matches in a file | `path`, `pattern` |
| `constant` | Fixed value (placeholder for quality scanners) | `value: string` |
| `prismaModel` | Count of `model X {}` blocks in a Prisma schema | `path: string` |
| `prismaModelList` | JSON array of model names from a Prisma schema | `path: string` |
| `prismaEnum` | Count of values in a named Prisma enum | `path: string`, `enum: string` |
| `trpcRouter` | Count of router entries in a tRPC root file | `path: string` |
| `trpcRouterList` | JSON array of router names from a tRPC root file | `path: string` |
| `gitStaleness` | Commits since a file was last changed (0 = up-to-date) | `path: string` |
| `packageEngines` | Node/runtime version from `package.json` `engines` field (strips `>=` operators) | `field?: string` (default `"node"`) |
| `tsconfigPaths` | Count of path aliases in `tsconfig.json` `compilerOptions.paths` (JSONC-aware) | `path?: string` (default `"tsconfig.json"`) |
| `pyprojectToml` | Version from `pyproject.toml` — Poetry and PEP 621 formats | `package?: string`, `field?: string` |
| `requirementsTxt` | Package version from `requirements.txt` | `package: string`, `path?: string` |
| `cargoToml` | Version from `Cargo.toml` — own version or dependency; supports Cargo workspaces (`[workspace.package]`, `[workspace.dependencies]`) | `package?: string`, `field?: string` |
| `goMod` | Module version from `go.mod` | `module: string` |
| `packageScript` | Returns `"true"`/`"false"` if a named npm script exists in `package.json` | `script` (required), `file` (optional, default `"package.json"`) |

Version normalization: `v22` matches `22.14.0` — partial mentions are valid.

</details>

## Scanners

Find and validate content in your AI doc files. Common ones: `inlineRegex`, `literalInMd`, `vaguenessPattern`, `hookValidity`, `coverageRatio`, `freshnessScore`.

<details>
<summary>Full scanner list (15)</summary>

### Drift scanners (compare against extractor value)

| Name | What it scans | Args |
|------|--------------|------|
| `inlineRegex` | All lines matching a regex | `pattern`, `flags?` |
| `codeBlockRegex` | Lines inside fenced code blocks only | `pattern`, `lang?`, `flags?` |
| `yamlField` | YAML front matter or inline YAML | `field` (dot-path) |
| `jsonField` | Inline JSON blocks | `field` (dot-path) |
| `literalInMd` | Literal string presence | `literal` |
| `pathReference` | File path reference | `path` |

### Quality scanners (no extractor value needed, use `constant`)

| Name | What it detects | Args |
|------|----------------|------|
| `vaguenessPattern` | Vague instructions ("be careful", "as needed", "use your judgment"…) | `patterns?: string[]` |
| `negativeConstraintDensity` | Positive/negative instruction ratio below threshold | `minRatio?: number` (default 1.0) |
| `contextBudget` | File token footprint — fails if estimated tokens exceed threshold | `maxTokens?: number` (default 3000), `followImports?: boolean` (follows `@file.md` chains up to depth 3) |
| `ruleGlobValidity` | Claude Code rules file — checks for YAML frontmatter and optional `paths:` field | `requirePaths?: boolean` (default false) |
| `hookValidity` | **Standalone.** Resolves `.claude/settings.json` from project root and validates each hook entry | — |
| `backtickEntityPresence` | Checks that `` `entity` `` appears as inline code in the doc | `entity: string` |
| `skillValidity` | **Standalone.** Globs `.claude/skills/**/*.md` from project root — validates YAML frontmatter has `name:` and `description:` | `requireDescription?: boolean` (default `true`) |
| `freshnessScore` | **Standalone.** Interprets commit count from `gitStaleness` — returns pass/warn/fail based on thresholds | `warnAfter?: number` (default 30), `failAfter?: number` (default 100) |
| `coverageRatio` | Checks what fraction of a JSON array (from `prismaModelList`/`trpcRouterList`) appears in the doc | `minRatio?: number` (default 0.8), `valueAllowlist?: string[]` |

**Standalone scanners** (`hookValidity`, `skillValidity`, `freshnessScore`) bypass `files.include` and resolve their own targets from the project root. You do not add their paths to `files.include` — they run once regardless of how many files are in scope.

`vaguenessPattern` accepts custom patterns via `scannerArgs.patterns` (array of regex strings).

`contextBudget` estimates tokens as `chars ÷ 4`. Designed to run over `.claude/rules/**/*.md` or `CLAUDE.md` to catch bloated always-on context files. With `followImports: true`, it resolves `@file.md` references recursively up to depth 3 and includes their token footprint in the total.

`ruleGlobValidity` is designed to run over `.claude/rules/**/*.md`. By default it fails if a rules file has no YAML frontmatter (meaning it loads at every session with no scoping). Set `requirePaths: true` to also fail if the frontmatter lacks a `paths:` field.

`freshnessScore` works with `gitStaleness` extractor. `gitStaleness` returns the commit count since the file was last changed; `freshnessScore` compares it to your thresholds:

```yaml
- id: claude-md-freshness
  extractor: gitStaleness
  extractorArgs:
    path: CLAUDE.md
  scanner: freshnessScore
  scannerArgs:
    warnAfter: 20   # ⚠ warn if >20 commits since last edit
    failAfter: 50   # ✗ fail if >50 commits
```

`coverageRatio` checks that a fraction of your actual entities (models, routers…) are mentioned in the docs — useful when you can't document everything but want to enforce a minimum:

```yaml
- id: prisma-model-coverage
  extractor: prismaModelList
  extractorArgs:
    path: src/server/db/prisma/schema.prisma
  scanner: coverageRatio
  scannerArgs:
    minRatio: 0.5          # at least 50% of models mentioned
  valueAllowlist:
    - MigrationVersion     # internal model, not required in CLAUDE.md
```

</details>

## CLI

```bash
ctxharness run       # run all assertions, exit 1 on drift
ctxharness check     # alias for run --format text
ctxharness scan      # scan a markdown file for verifiable claims without a config file
ctxharness score     # run assertions and report a 0-100 health score with grade (S/A/B/C/D/F)
ctxharness trend     # show cross-run drift score history — sparkline, direction, per-run table
ctxharness snapshot  # save a quality snapshot to .ctxharness/snapshots/
ctxharness diff      # compare against latest snapshot — exit 1 on score regression
ctxharness fix       # auto-fix version drift — dry-run by default, --apply writes files
ctxharness doctor    # comprehensive health check with L1/L2/L3 breakdown and remediation advice
ctxharness init      # scaffold .ctxharness.yml
```

`ctxharness init --hooks` also installs Husky post-merge / post-checkout hook scripts alongside the config.

Options:

```
-c, --config <path>    Config file path (default: .ctxharness.yml)
-f, --format <fmt>     Output format: text | json | gha (default: text)
-r, --root <dir>       Project root (default: cwd)
-w, --watch            Re-run on file changes (run command only)
```

`ctxharness fix` finds every assertion where the actual version differs from expected on a specific line and shows what it would change. Pass `--apply` to write the files:

```
$ ctxharness fix
CLAUDE.md:13  prisma-version  7.5 → 7.7.0
CLAUDE.md:42  next-version    15.2.0 → 15.3.1

Run ctxharness fix --apply to write changes.
```

### Zero-config scan

Before setting up a full `.ctxharness.yml`, you can scan any AI instruction file for verifiable claims:

```bash
npx ctxharness scan CLAUDE.md
```

This detects file paths, npm scripts, and version numbers mentioned in the file and checks each against your codebase. Paths and scripts first, because those are the claims most likely to silently break agent behavior when they drift.

```
Scanning CLAUDE.md...

  src/config/auth     fileExists   ✗ path not found (moved to src/modules/auth/config.ts?)
  npm run typecheck   packageScript  ✗ script not found in package.json
  Node.js 22.14.0    version      ✓ matches .nvmrc

2 issues found. Run with --suggest-config to generate .ctxharness.yml.
```

Since v0.4.2, `scan` follows `@file.md` includes (Claude/Gemini/Cursor convention) up to depth 3. Claims in included files are detected and verified — a drift in `@agents.md` referenced from `CLAUDE.md` is no longer invisible.

```bash
npx ctxharness scan CLAUDE.md --suggest-config   # generate a starter .ctxharness.yml
npx ctxharness scan CLAUDE.md --exit-zero        # warn without blocking (hooks / CI)
```

The detector filters out common false positives: Claude Code slash commands (`/plan`, `/ship`), URL route patterns (`/api/chunk`, `/about/`), and template placeholders (`{slug}`, `[owner]`).

**scan vs run:** `scan` is for discovery — zero-config, always informational. `run` is for enforcement — requires `.ctxharness.yml`, exits 1 on drift.

**Husky hook** — the `post-merge` template automatically picks the right mode:

```bash
# .husky/post-merge (generated by ctxharness init --hooks)
if [ -f ".ctxharness.yml" ]; then
  ctxharness check          # blocking — full enforcement
else
  ctxharness scan --exit-zero  # informational — zero-config discovery
fi
```

### Snapshot workflow

Track quality over time and block regressions in CI:

```bash
# Save baseline after initial setup
ctxharness snapshot

# In CI: compare against the committed baseline
ctxharness diff     # exit 1 if score dropped
```

Snapshots are saved to `.ctxharness/snapshots/` with timestamp. Commit the latest snapshot file to use `diff` in CI.

### Trend history

Every `run`, `check`, `score`, and `doctor` execution auto-records a drift score to `~/.ctxharness/history.jsonl`. The `trend` command shows your score trajectory over time:

```bash
ctxharness trend

Trend — myproject (8 runs)

  Sparkline   ▃▅▆▇▇▇██
  Direction   ↑ improving  (+14 pts over 8 runs)
  Avg Score   91/100

  Date                    Score      G      Pass   Fail   Time
  ──────────────────────────────────────────────────────────────
  May 06, 14:23:01       100/100    S      5      0      42ms
  May 06, 11:45:22        98/100    S      5      0      38ms
  May 05, 09:12:08        87/100    B      4      1      55ms
  ...
```

Direction is computed by comparing the average of the first third of runs against the last third: `improving` (delta > 3 pts), `worsening` (delta < -3 pts), or `flat`.

```bash
ctxharness trend --all          # all projects
ctxharness trend --limit 50     # last 50 runs (default: 20)
ctxharness trend --project api  # specific project name
```

In CI, use `--no-trend` to skip recording — useful when you only want trend data from your main branch, not every PR run:

```bash
ctxharness run --no-trend
```

### warn status

Assertions can return three states: `pass`, `warn`, or `fail`. `warn` is counted as 0.5 in the score — useful for staleness checks where you want early signal without blocking CI:

```
⚠ 1 warn   — claude-md-freshness: 35 commits since last edit
```

`ctxharness doctor` categorizes all issues by layer, shows a per-layer score, and suggests next actions:

```
ctxharness doctor

L1  Doc Drift           ██████████  100/100
L2  Instruction Quality ████████░░   80/100
L3  Context Assembly    ██████░░░░   60/100

Score: 80/100  Grade: B

Issues:
  L2  no-vague-language   AGENTS.md:14   vague pattern found: "be careful"
  L3  hook-validity        .claude/settings.json   hook entry has empty matcher
```

## Plugin API

Register custom extractors and scanners programmatically:

```typescript
import { definePlugin, loadPlugin } from '@florianbruniaux/ctxharness-core'

const myPlugin = definePlugin({
  extractors: [
    {
      name: 'myExtractor',
      fn: (root, args) => {
        // read ground truth from codebase, return a string
        return '1.2.3'
      },
    },
  ],
  scanners: [
    {
      name: 'myScanner',
      fn: (filePath, expectedValue, args) => {
        // check the file, return ScanResult[]
        return [{ status: 'pass', line: 0, actual: expectedValue }]
      },
    },
  ],
})

loadPlugin(myPlugin)
```

Use `name: myExtractor` and `scanner: myScanner` in your `.ctxharness.yml` like any built-in.

## Stack presets

Ready-to-use config templates for common stacks:

| Preset | Path | Covers |
|--------|------|--------|
| T3 (Next.js + Prisma + tRPC) | `templates/presets/t3.yml` | node, next, typescript, prisma, trpc versions + model/router counts |
| Next.js App Router | `templates/presets/next-app-router.yml` | node, next, typescript, react versions + quality assertions |
| Python | `templates/presets/python.yml` | python version, pyproject.toml deps + quality assertions |
| Go | `templates/presets/go.yml` | go toolchain version, go.mod deps + quality assertions |
| Rust | `templates/presets/rust.yml` | crate version, Cargo.toml deps + quality assertions (workspace-aware) |

Copy a preset as your `.ctxharness.yml` starting point:

```bash
cp node_modules/ctxharness/templates/presets/t3.yml .ctxharness.yml
```

## CI integration

GitHub Actions:

```yaml
- name: Check AI doc drift
  uses: FlorianBruniaux/ctxharness@v0.4
  with:
    config: .ctxharness.yml
    format: gha
```

Or copy `templates/ci/github-actions.yml` for a full workflow. GitLab CI and CircleCI templates are at `templates/ci/gitlab-ci.yml` and `templates/ci/circleci.yml`.

Husky (post-merge, post-checkout): copy from `templates/husky/`.

### `.claude/settings.json` vs `settings.local.json`

Claude Code follows a two-file convention for project settings:

- **`settings.json`** — committed to the repo. Contains config that should work for anyone who clones the project: hook definitions, permission rules, shared assertions. Use relative paths for hook commands (`.claude/hooks/my-hook.sh`, not `/Users/yourname/...`).
- **`settings.local.json`** — gitignored. Contains machine-specific or personal overrides: your own keybindings, local path overrides, personal MCP servers.

`hookValidity` validates `settings.json`. If a hook command contains an absolute path (e.g. `/Users/yourname/...`), it returns `status: warn` — those paths break for every other contributor.

The same layering applies to `CLAUDE.md` files: project-level goes in the repo root (committed), personal goes in `~/.claude/CLAUDE.md` (your machine only). [Claude Code memory docs](https://docs.anthropic.com/en/docs/claude-code/memory).

## Ecosystem Positioning

```
                         FACTUAL ACCURACY
                                ▲
                                │
                                │              ★ ctxharness
                                │         "Are the claims still true?"
                                │          paths · scripts · versions
                                │
  ──────────────────────────────┼──────────────────────────────────► RUNTIME
  [vigiles]                     │                                    VERIFICATION
  TS spec → CLAUDE.md           │
                                │
  [AgentLint]                   │     [cclint / cursor-doctor]
  structural linter             │     syntax & format checks
                                │
  [Ruler / rulesync]            │
  rule distribution             │
                         STATIC / STRUCTURAL
```

ctxharness does not compete with any of these tools. It validates what they write, compile, or distribute.

## Taxonomy

ctxharness covers three layers of context engineering testing:

| Layer | What |
|-------|------|
| **L1 Doc Drift** | Facts in AI docs vs code reality — file existence, npm scripts, versions, counts, regex captures |
| **L2 Instruction Quality** | Vague language, positive/negative ratio, token budget, multi-file coherence |
| **L3 Context Assembly** | Hook validation, skill loading, rule glob validity, coverage ratio |

L4 (agent behavior eval) is out of scope — use [Promptfoo](https://promptfoo.dev) or [Braintrust](https://braintrust.dev) for that.

**ctxharness vs Promptfoo**: Promptfoo evals what your agent *says* (output quality). ctxharness evals what your agent *reads* (input freshness). They're complementary, not competing.

## Further Reading

The problem ctxharness addresses is well-documented. These are the sources worth reading.

**Context engineering — why accuracy matters**

- [Context Engineering](https://simonwillison.net/2025/Jun/27/context-engineering/) — Simon Willison, June 2025. Why "context engineering" is a better term than "prompt engineering" and what it means in practice.
- [The Rise of Context Engineering](https://www.langchain.com/blog/the-rise-of-context-engineering) — LangChain, June 2025. *"Most of the time when an agent is not performing reliably, the underlying cause is that the appropriate context has not been communicated to the model."*
- [Context Engineering for Large Codebases](https://packmind.com/context-engineering-ai-coding/context-engineering-large-codebases/) — Packmind, April 2026. Documents "context drift" — stale instruction files referencing deprecated frameworks cause agents to silently generate code using wrong patterns.

**What stale context does to LLMs**

- [Contextual Drag: How Errors in the Context Affect LLM Reasoning](https://arxiv.org/abs/2602.04288) — arXiv, Feb 2026. Wrong context causes 10-20% performance drops across 11 models and 8 reasoning tasks. Self-refinement makes it worse, not better.
- [Knowledge Conflicts for LLMs: A Survey](https://arxiv.org/abs/2403.08319) — EMNLP 2024. Temporal knowledge conflicts (outdated context vs. model knowledge) are a primary source of factually wrong outputs. LLMs may generate code using deprecated function signatures from older library versions.
- [Lost in the Middle](https://arxiv.org/abs/2307.03172) — Stanford / ACL 2024. Relevant information placed in the middle of long contexts is systematically under-weighted by LLMs. Instruction files that accumulate stale content push critical facts into this dead zone.
- [Your Agent's Context Is a Junk Drawer](https://www.augmentcode.com/blog/your-agents-context-is-a-junk-drawer) — Augment Code, Feb 2026. Documents "context collapse" — agents forget earlier constraints when context grows stale and unmanaged.

**The CLAUDE.md / AGENTS.md problem specifically**

- [Writing a Good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md) — HumanLayer, Nov 2025. *"Don't include code snippets — they will become out-of-date quickly."* Direct practitioner warning on content drift.
- [New Research Reassesses the Value of AGENTS.md Files](https://www.infoq.com/news/2026/03/agents-context-file-value-review/) — InfoQ, March 2026. ETH Zurich study: LLM-generated context files reduce task success by 3% on average and increase inference costs by 20%+. Authors recommend limiting instructions to non-inferable details — exactly the facts ctxharness verifies.
- [When AGENTS.md Backfires](https://notchrisgroves.com/when-agents-md-backfires/) — Feb 2026. Only 14.5% of agent context files include security instructions. LLM-generated files reduced task success in 5 of 8 evaluation settings.

## License

MIT
