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

  # allowlist: skip known-intentional mismatches in legacy files
  - id: next-version-strict
    extractor: packageJson
    extractorArgs:
      package: next
    scanner: inlineRegex
    scannerArgs:
      pattern: 'Next\.js\s+v?(\d+(?:\.\d+(?:\.\d+)?)?)'
    allowlist:
      - CHANGELOG.md
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
| `prismaModel` | Count of `model X {}` blocks in a Prisma schema | `path: string` |
| `prismaEnum` | Count of values in a named Prisma enum | `path: string`, `enum: string` |
| `trpcRouter` | Count of router entries in a tRPC root file | `path: string` |
| `gitStaleness` | Commits since a file was last changed (0 = up-to-date) | `path: string` |
| `packageEngines` | Node/runtime version from `package.json` `engines` field (strips `>=` operators) | `field?: string` (default `"node"`) |
| `tsconfigPaths` | Count of path aliases in `tsconfig.json` `compilerOptions.paths` (JSONC-aware) | `path?: string` (default `"tsconfig.json"`) |

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
| `contextBudget` | File token footprint — fails if estimated tokens exceed threshold | `maxTokens?: number` (default 3000), `followImports?: boolean` (follows `@file.md` chains, depth 3) |
| `ruleGlobValidity` | Claude Code rules file — checks for YAML frontmatter and optional `paths:` field | `requirePaths?: boolean` (default false) |
| `hookValidity` | Claude Code `settings.json` — validates each hook entry has a non-empty matcher and hooks array | — |
| `backtickEntityPresence` | Checks that `` `entity` `` appears as inline code in the doc | `entity: string` |
| `skillValidity` | `.claude/skills/` files — validates YAML frontmatter has `name:` and `description:` | `requireDescription?: boolean` (default `true`) |

`vaguenessPattern` accepts custom patterns via `scannerArgs.patterns` (array of regex strings).

`contextBudget` estimates tokens as `chars ÷ 4`. Designed to run over `.claude/rules/**/*.md` or `CLAUDE.md` to catch bloated always-on context files. With `followImports: true`, it resolves `@file.md` references recursively (depth 3) and includes their sizes — useful when your `CLAUDE.md` uses `@-imports` to compose context.

`ruleGlobValidity` is designed to run over `.claude/rules/**/*.md`. By default it fails if a rules file has no YAML frontmatter (meaning it loads at every session with no scoping). Set `requirePaths: true` to also fail if the frontmatter lacks a `paths:` field.

## CLI

```bash
ctxharness run      # run all assertions, exit 1 on drift
ctxharness check    # alias for run --format text
ctxharness score    # run assertions and report a 0-100 health score with grade (S/A/B/C/D/F)
ctxharness fix      # auto-fix version drift — dry-run by default, --apply writes files
ctxharness doctor   # comprehensive health check with L1/L2/L3 breakdown and remediation advice
ctxharness init     # scaffold .ctxharness.yml
```

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
import { definePlugin, loadPlugin } from '@ctxharness/core'

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

Copy a preset as your `.ctxharness.yml` starting point:

```bash
cp node_modules/ctxharness/templates/presets/t3.yml .ctxharness.yml
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

Or copy `templates/ci/github-actions.yml` for a full workflow. GitLab CI and CircleCI templates are at `templates/ci/gitlab-ci.yml` and `templates/ci/circleci.yml`.

Husky (post-merge, post-checkout): copy from `templates/husky/`.

## Taxonomy

ctxharness covers three layers of context engineering testing:

| Layer | What | Ships |
|-------|------|-------|
| **L1 Doc Drift** | Facts in AI docs vs code reality | v0.1 |
| **L2 Instruction Quality** | Vague language, positive/negative ratio, multi-file coherence, token budget | v0.1 (quality) · v0.3 (coherence) |
| **L3 Context Assembly** | Hook validation, skill loading, MCP routing | v0.1 (`hookValidity`) · v0.4 (full) |

L4 (agent behavior eval) is out of scope — use [Promptfoo](https://promptfoo.dev) or [Braintrust](https://braintrust.dev) for that.

## License

MIT
