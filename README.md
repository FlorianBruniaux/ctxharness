# ctxharness

Detect AI documentation drift. Check that your `CLAUDE.md`, `AGENTS.md`, and other AI instruction files stay in sync with your actual codebase.

```bash
npx ctxharness init   # scaffold .ctxharness.yml
npx ctxharness run    # check for drift
```

## The problem

Your AI docs say `Next.js v15`. Your `package.json` has `next@14.2.3`. Your agent is coding against the wrong version.

This is **L1 doc drift** — facts in AI instruction files that no longer match code reality. ctxharness catches it before it causes problems.

## Install

```bash
npm install -g ctxharness
# or
pnpm add -D ctxharness
```

## Quick start

```bash
# 1. Create config
ctxharness init

# 2. Edit .ctxharness.yml to match your stack
# 3. Run
ctxharness run
```

Output:

```
AI Context Test — 3 assertions

fact                    expected      mentions  status
────────────────────────────────────────────────────────────────────────
next-version            15.3.1               2  ✓ 2/2 pass
node-version            22.14.0              1  ✓ 1/1 pass
prisma-version          6.2.1                1  ✗ 1 mismatch
────────────────────────────────────────────────────────────────────────

Mismatches
────────────────────────────────────────────────────────────────────────
prisma-version          CLAUDE.md                                   42  6.2.1       5.0
────────────────────────────────────────────────────────────────────────
✗ 1 mismatch(es) — update the file(s) listed above
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
```

## Extractors

Each extractor reads ground truth from your codebase:

| Name | What it reads | Args |
|------|--------------|------|
| `packageJson` | `dependencies`/`devDependencies` version | `package: string` |
| `packageManager` | `packageManager` field (strips corepack hash) | — |
| `nvmrc` | `.nvmrc` file | — |
| `fileExists` | Whether a path exists (`"true"`/`"false"`) | `path: string` |
| `regexScan` | Capture group from any file | `path`, `pattern`, `group?` |
| `countMatches` | Count of pattern matches in a file | `path`, `pattern` |

## Scanners

Each scanner finds mentions in your AI doc files:

| Name | What it scans | Args |
|------|--------------|------|
| `inlineRegex` | All lines matching a regex | `pattern`, `flags?` |
| `codeBlockRegex` | Lines inside fenced code blocks only | `pattern`, `lang?`, `flags?` |
| `yamlField` | YAML front matter or inline YAML | `field` (dot-path) |
| `jsonField` | Inline JSON blocks | `field` (dot-path) |
| `literalInMd` | Literal string presence | `literal` |
| `pathReference` | File path reference | `path` |

Version normalization: if your doc says `v22` and the ground truth is `22.14.0`, ctxharness matches on the major only. Partial mentions are valid.

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

Husky hooks: copy `templates/husky/post-merge` and `templates/husky/post-checkout` to `.husky/`.

## Context Engineering Testing taxonomy

ctxharness targets three layers:

- **L1 Doc Drift** — facts in AI docs vs code reality (v0.1)
- **L2 Instruction Quality** — multi-file coherence, contradictions, redundancy (v0.3)
- **L3 Context Assembly** — skill loading, hook validation, MCP routing (v0.4)

## License

MIT
