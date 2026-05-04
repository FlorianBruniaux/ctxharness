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
pnpm test            # vitest (31 tests)
pnpm test:watch      # watch mode
pnpm lint            # tsc --noEmit
pnpm fmt             # prettier --write
```

## Key files

| File | Purpose |
|------|---------|
| `packages/core/src/config.ts` | Zod schema — `.ctxharness.yml` format |
| `packages/core/src/extractors/index.ts` | 6 extractors (ground truth from code) |
| `packages/core/src/scanners/index.ts` | 6 scanners (find mentions in docs) |
| `packages/core/src/runner.ts` | Orchestrates run, returns `RunResult` |
| `packages/core/src/reporter.ts` | text / json / gha output formats |
| `packages/cli/src/index.ts` | CLI entry point (run / check / init) |
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

- v0.1 — L1 core (this release): 6 extractors, 6 scanners, CLI, GHA
- v0.2 — Stack-aware extractors (Prisma, tRPC, Zod, NextAuth, Knock)
- v0.3 — L2 multi-file coherence + hook validation
- v0.4 — L3 context assembly + plugin API
- v0.5 — LSP + VSCode extension
- v1.0 — Stack presets (t3, next-app-router, monorepo-turbo…)
