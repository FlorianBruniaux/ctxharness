# ctxharness

**AI documentation drift detection for teams using Claude Code, Cursor, Copilot, and any agent-driven workflow.**

Your `CLAUDE.md` says Prisma 7.5. Your `package.json` has `^7.7.0`. Your agent is reasoning against stale facts — silently, on every session.

ctxharness catches this before it reaches your agents.

```bash
npx ctxharness init   # scaffold .ctxharness.yml
npx ctxharness run    # check for drift
```

## What it checks

**L1 — Fact drift**: versions, file existence, counts, regex captures — any extractable fact from your codebase vs what your AI docs claim.

**L2 — Instruction quality**: vague language that degrades agent reliability ("be careful", "use your judgment"), positive/negative instruction ratio, multi-file coherence (v0.3).

**L3 — Context assembly**: hook validation, skill loading, MCP routing (v0.4).

**Brownfield-first.** Works on your existing `CLAUDE.md`/`AGENTS.md`/`.cursorrules` with zero migration.

## Install

```bash
npm install -g ctxharness
# or
pnpm add -D ctxharness
```

## Quick start

```bash
ctxharness init          # creates .ctxharness.yml
ctxharness run           # check all assertions
```

Example output:

```
AI Context Test — 5 assertions

fact                    expected       mentions  status
────────────────────────────────────────────────────────────────────────
next-version            16.2.3                1  ✗ 1 mismatch
prisma-version          7.7.0                 4  ✗ 1 mismatch
node-version            22.14.0               1  ✓ 1/1 pass
no-vague-language       check                 2  ✓ 2/2 pass
instruction-balance     check                 2  ✓ 2/2 pass
────────────────────────────────────────────────────────────────────────

Mismatches
────────────────────────────────────────────────────────────────────────
next-version            CLAUDE.md                                     13  16.2.3      16.2.0
prisma-version          CLAUDE.md                                     13  7.7.0       7.5
────────────────────────────────────────────────────────────────────────
✗ 2 mismatch(es) — update the file(s) listed above
```

## Configuration

`.ctxharness.yml`:

```yaml
version: 1

files:
  include:
    - 'CLAUDE.md'
    - 'AGENTS.md'
    - '.cursorrules'
    - 'doc/**/*.md'
  exclude:
    - 'node_modules/**'

assertions:
  # L1 — fact drift
  - id: next-version
    extractor: packageJson
    extractorArgs:
      package: next
    scanner: inlineRegex
    scannerArgs:
      pattern: 'Next\.js\s+v?(\d+(?:\.\d+(?:\.\d+)?)?)'

  - id: node-version
    extractor: nvmrc
    scanner: inlineRegex
    scannerArgs:
      pattern: 'Node(?:\.js)?\s+v?(\d+(?:\.\d+(?:\.\d+)?)?)'

  # L2 — instruction quality
  - id: no-vague-language
    extractor: constant
    extractorArgs:
      value: check
    scanner: vaguenessPattern

  - id: instruction-balance
    extractor: constant
    extractorArgs:
      value: check
    scanner: negativeConstraintDensity
    scannerArgs:
      minRatio: 2.0
```

## Extractors

Read ground truth from your codebase:

| Name | What it reads | Args |
|------|--------------|------|
| `packageJson` | `dependencies`/`devDependencies` version | `package: string` |
| `packageManager` | `packageManager` field (strips corepack hash) | — |
| `nvmrc` | `.nvmrc` file | — |
| `fileExists` | Whether a path exists (`"true"`/`"false"`) | `path: string` |
| `regexScan` | Capture group from any file | `path`, `pattern`, `group?` |
| `countMatches` | Count of pattern matches in a file | `path`, `pattern` |
| `constant` | Fixed value (placeholder for quality scanners) | `value: string` |

Version normalization: `v22` matches `22.14.0` — partial mentions are valid.

## Scanners

Find and validate content in your AI doc files:

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
| `contextBudget` | File token footprint — fails if estimated tokens exceed threshold | `maxTokens?: number` (default 3000) |
| `ruleGlobValidity` | Claude Code rules file — checks for YAML frontmatter and optional `paths:` field | `requirePaths?: boolean` (default false) |

`vaguenessPattern` accepts custom patterns via `scannerArgs.patterns` (array of regex strings).

`contextBudget` estimates tokens as `chars ÷ 4`. Designed to run over `.claude/rules/**/*.md` or `CLAUDE.md` to catch bloated always-on context files.

`ruleGlobValidity` is designed to run over `.claude/rules/**/*.md`. By default it fails if a rules file has no YAML frontmatter (meaning it loads at every session with no scoping). Set `requirePaths: true` to also fail if the frontmatter lacks a `paths:` field.

## CLI

```bash
ctxharness run    # run all assertions, exit 1 on drift
ctxharness check  # alias for run --format text
ctxharness init   # scaffold .ctxharness.yml
```

Options:

```
-c, --config <path>    Config file path (default: .ctxharness.yml)
-f, --format <fmt>     Output format: text | json | gha (default: text)
-r, --root <dir>       Project root (default: cwd)
```

## CI integration

GitHub Actions:

```yaml
- name: Check AI doc drift
  uses: FlorianBruniaux/ctxharness@v0.1
  with:
    config: .ctxharness.yml
    format: gha
```

Or copy `templates/ci/github-actions.yml` for a full workflow.

Husky (post-merge, post-checkout): copy from `templates/husky/`.

## Taxonomy

ctxharness covers three layers of context engineering testing:

| Layer | What | Ships |
|-------|------|-------|
| **L1 Doc Drift** | Facts in AI docs vs code reality | v0.1 |
| **L2 Instruction Quality** | Vague language, positive/negative ratio, multi-file coherence, token budget | v0.1 (quality) · v0.3 (coherence) |
| **L3 Context Assembly** | Hook validation, skill loading, MCP routing | v0.4 |

L4 (agent behavior eval) is out of scope — use [Promptfoo](https://promptfoo.dev) or [Braintrust](https://braintrust.dev) for that.

## License

MIT
