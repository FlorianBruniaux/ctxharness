# ctxharness — AI Agent Instructions

Framework for detecting AI documentation drift (L1/L2/L3 context engineering testing).

## Repository structure

```
packages/
├── core/        @ctxharness/core — lib (extractors, scanners, runner, reporter)
└── cli/         ctxharness — CLI binary (commander)
action.yml       GitHub Action wrapper
templates/       Husky hooks + CI workflow templates
```

## Commands

```bash
pnpm build           # compile all packages
pnpm test            # vitest (129 tests)
pnpm test:watch      # watch mode
pnpm lint            # tsc --noEmit
pnpm fmt             # prettier --write
```

## Key files

| File | Purpose |
|------|---------|
| `packages/core/src/config.ts` | Zod schema — `.ctxharness.yml` format |
| `packages/core/src/extractors/index.ts` | 19 extractors (ground truth from code) |
| `packages/core/src/scanners/index.ts` | 15 scanners (find mentions in docs) |
| `packages/core/src/runner.ts` | Orchestrates run, returns `RunResult` |
| `packages/core/src/reporter.ts` | text / json / gha output formats |
| `packages/core/src/snapshot.ts` | Snapshot save / load / diff for trend tracking |
| `packages/core/src/plugin.ts` | Plugin API — register custom extractors/scanners |
| `packages/cli/src/index.ts` | CLI entry point (run / check / score / fix / doctor / init / snapshot / diff) |
| `packages/core/src/__tests__/fixtures/` | Test fixture files |

## Architecture rules

- TypeScript strict + ESM only (`"type": "module"`)
- All internal imports use `.js` extension (NodeNext resolution)
- No `any` — use `unknown` + type guards
- `noUncheckedIndexedAccess` on — always null-check array access
- Extractors return `string` (ground truth value)
- Scanners return `ScanResult[]` (one per mention found)
- New extractor or scanner: add to the union in `config.ts` + registry in the module

## Adding an extractor

1. Add the name to `ExtractorNameSchema` in `config.ts`
2. Implement the function in `extractors/index.ts`
3. Add to the `EXTRACTORS` registry
4. Add fixture + test in `__tests__/extractors.test.ts`

## Adding a scanner

1. Add the name to `ScannerNameSchema` in `config.ts`
2. Implement the function in `scanners/index.ts`
3. Add to the `SCANNERS` registry
4. Add fixture + test in `__tests__/scanners.test.ts`

## What NOT to Add

Boundaries that keep ctxharness focused and safe:

- **Never add a scanner that has write side-effects**: Scanners are read-only by contract. A scanner that modifies files, sends network requests, or executes code is a security violation.
- **Never add async I/O in scanner functions**: Scanners run synchronously. All file reads use `fs.readFileSync`. Async scanners break the sequential collection contract.
- **Never add a scanner that walks outside the project root**: Every scanner must stay within the `root` directory passed at runtime. Traversal outside it is a path traversal vulnerability.
- **Never add a second config format**: Configuration is YAML only (`.ctxharness.yml`). No TOML, no JSON, no env-var-only config.
- **Never add a scanner dependency on another scanner's output**: Scanners are independent. Inter-scanner dependencies require a pipeline rewrite.
- **Never output binary content in the harness bundle**: The bundle is UTF-8 text only. Scanners must skip binary files or emit a placeholder line.

## Testing

Fixtures live in `packages/core/src/__tests__/fixtures/`. No mocking — tests hit real files.

```bash
pnpm test                              # all tests
pnpm vitest run src/__tests__/runner   # one suite
```

## Versioning

Semver. `CHANGELOG.md` updated before every release.

```bash
# Bump version in both package.json files + root
# Update CHANGELOG.md
# pnpm build && pnpm test
# git tag v0.x.0
# pnpm -r publish --no-git-checks
```

## Roadmap

### Released in v0.1.0

- L1/L2/L3 full surface: 15 extractors, 15 scanners
- 8 CLI commands: run / check / score / fix / doctor / init / snapshot / diff
- Plugin API, stack presets (T3, Next App Router), GitHub Action

### Upcoming

- v0.5 — LSP + VSCode extension
- v1.0 — monorepo-turbo preset, multi-root support
