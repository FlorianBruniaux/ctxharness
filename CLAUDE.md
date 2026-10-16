# ctxharness: AI Agent Instructions

Framework for AI documentation drift, passive configuration diagnosis, static measurements and a reusable export. See [documentation](docs/README.md) and the [active roadmap](docs/roadmap.md) for delivery status.

## Repository structure

```
packages/
├── core/        @florianbruniaux/ctxharness-core — lib (extractors, scanners, runner, reporter)
└── cli/         ctxharness — CLI binary (commander)
action.yml       GitHub Action wrapper
templates/       Husky hooks + CI workflow templates
```

## Commands

```bash
pnpm build           # compile all packages
pnpm test            # all Vitest suites; obtain counts from the current run
pnpm test:watch      # watch mode
pnpm lint            # tsc --noEmit
pnpm fmt             # prettier --write
pnpm fmt:check       # check formatting, including existing fixture limitations
```

## Key files

| File                                    | Purpose                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/core/src/config.ts`           | Zod schema, `.ctxharness.yml` format                                                       |
| `packages/core/src/extractors/index.ts` | 20 extractors (ground truth from code)                                                     |
| `packages/core/src/scanners/index.ts`   | 15 scanners (find mentions in docs)                                                        |
| `packages/core/src/runner.ts`           | Orchestrates run, returns `RunResult`                                                      |
| `packages/core/src/reporter.ts`         | text / json / gha output formats                                                           |
| `packages/core/src/trend.ts`            | Trend history, appendTrendRecord, loadTrendHistory, summarizeTrend                         |
| `packages/core/src/snapshot.ts`         | Snapshot save / load / diff for trend tracking                                             |
| `packages/core/src/populate.ts`         | `populateFromConfig` + `assertionsToYaml`, claim→Assertion mapping                         |
| `packages/core/src/plugin.ts`           | Plugin API, register custom extractors/scanners                                            |
| `packages/core/src/agent-config/`       | Host adapters, inventory, passive scanners, release validation and parity                  |
| `packages/cli/src/index.ts`             | CLI entry point, including separate documentation and configuration snapshot/diff commands |
| `packages/core/src/__tests__/fixtures/` | Test fixture files                                                                         |

## Architecture rules

- TypeScript strict + ESM only (`"type": "module"`)
- All internal imports use `.js` extension (NodeNext resolution)
- No `any`, use `unknown` + type guards
- `noUncheckedIndexedAccess` on, always null-check array access
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
- **Keep optimization outside this repository**: Session collectors, before/after experiments, semantic candidate generation and candidate adoption belong to a separate project. Existing documentation-drift helpers retain their behavior.
- **Separate evidence levels**: Declaration, supported applicability, observation and estimation are distinct. Missing evidence stays unknown. Imported runtime results do not prove native loading, trust, execution or benefit.
- **Document actual delivery**: Main, open PRs and published packages are different states. Do not advertise unmerged flags or exports as available on main, or treat a local fixture result as production evidence.

## Testing

Fixtures live in `packages/core/src/__tests__/fixtures/`. No mocking, tests hit real files.

```bash
pnpm test                              # all tests
pnpm exec vitest run packages/core/src/__tests__/runner.test.ts # one suite
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

### Current source version: v0.5.0

- `scan` command, zero-config heuristic claim detection (semver, paths, npm scripts)
- `trend` command, cross-run drift score history with sparkline and direction detection
- `populate` command, suggest new assertions for claims detected in declared files but not yet covered
- `init` auto-scans existing AI doc files and generates assertions from detected claims
- `packageScript` extractor, validates npm script references in AI docs
- Extractors and scanners are listed in `config.ts` and their registries; obtain test counts from the current run
- Documentation commands: run / check / scan / score / fix / doctor / init / snapshot / diff / trend / populate
- Plugin API, stack presets (T3, Next App Router), GitHub Action
- `--no-trend` flag on run/check/score/doctor to skip history recording

### Active delivery

Version `0.5.0` includes PRs #11 to #14: correctness fixes (#2 to #4), reusable contract/portable export (#5), declared coverage (#6) and static budget (#7). Configuration `config-snapshot`/`config-diff` (#8) and explicit tool availability (#9) remain separate opt-in extensions. Tagging source and publishing npm packages are separate operations; an installed `0.4.6` does not establish the presence of these additions.

Follow [roadmap #10](https://github.com/FlorianBruniaux/ctxharness/issues/10), [docs/roadmap.md](docs/roadmap.md) and the [contract reference](docs/contracts/README.md). The older design notes are historical context, not the current delivery checklist. Do not revive an expanded optimization backlog.
