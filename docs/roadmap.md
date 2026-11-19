# Configuration audit and export roadmap

Updated: 2026-11-19. Delivery status covers [roadmap #10](https://github.com/FlorianBruniaux/ctxharness/issues/10), the `v0.5.0` and `v0.6.0` source tags and npm publication of `0.6.0`. [Documentation index](README.md).

## Current delivery status

Version `0.6.0` includes the `0.5.0` documentation-drift commands, passive Claude Code/Codex configuration diagnosis, portable export and both optional extensions, plus explicit Claude project expectations. The [CLI](https://www.npmjs.com/package/ctxharness/v/0.6.0) and [core library](https://www.npmjs.com/package/@florianbruniaux/ctxharness-core/v/0.6.0) were published to npm on 2026-11-19, both with the `latest` tag. Anonymous `npx ctxharness` was verified in a fresh repository with an empty cache and an isolated npm prefix. Consult [the doctor guide](doctor.md) for behavior and [the changelog](../CHANGELOG.md) for release history.

The following PRs were merged into `main` on 2026-10-15 and are included in the `v0.5.0` source tag. Published package availability remains a separate fact:

| Order              | Issues                                                                                                                                                                                   | Integrated behavior                                                                                              | PR and dependency                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1                  | [#2](https://github.com/FlorianBruniaux/ctxharness/issues/2), [#3](https://github.com/FlorianBruniaux/ctxharness/issues/3), [#4](https://github.com/FlorianBruniaux/ctxharness/issues/4) | Bound imported reads, validate malformed hook declarations and distinguish MCP resource limits from credentials. | [#11](https://github.com/FlorianBruniaux/ctxharness/pull/11), based on `main` |
| 2                  | [#5](https://github.com/FlorianBruniaux/ctxharness/issues/5)                                                                                                                             | Reusable doctor contract and validated portable export.                                                          | [#12](https://github.com/FlorianBruniaux/ctxharness/pull/12), based on #11    |
| 3                  | [#6](https://github.com/FlorianBruniaux/ctxharness/issues/6)                                                                                                                             | Declared coverage, explicit unsupported surfaces and unresolved evidence.                                        | #12                                                                           |
| 4                  | [#7](https://github.com/FlorianBruniaux/ctxharness/issues/7)                                                                                                                             | Attributed static size ledger and named estimation methods.                                                      | #12                                                                           |
| Optional extension | [#8](https://github.com/FlorianBruniaux/ctxharness/issues/8)                                                                                                                             | Separate configuration snapshots and deterministic structural comparisons.                                       | [#13](https://github.com/FlorianBruniaux/ctxharness/pull/13), based on #12    |
| Optional extension | [#9](https://github.com/FlorianBruniaux/ctxharness/issues/9)                                                                                                                             | Explicit filesystem tool availability without installation or execution.                                         | [#14](https://github.com/FlorianBruniaux/ctxharness/pull/14), based on #12    |

Integration preserved the dependency order: #11, #12, then #13 and #14. The two optional extensions were reviewed against #12 and verified together; neither is required to consume the audit/export foundation. Each PR retains its own validation results and implementation documentation.

Source on `main` now exposes `--export portable`, `--coverage`, `--budget`, the explicit tool options, `config-snapshot` and `config-diff`. The historical documentation commands and output formats remain compatibility requirements. See [the doctor guide](doctor.md), [audit details](configuration-audit.md) and [versioned contracts](contracts/README.md) for examples and limits.

## Profile checks in `v0.6.0`

[A2 (#19)](https://github.com/FlorianBruniaux/ctxharness/pull/19) adds [`doctor --expect`](doctor.md#explicit-project-expectations) for Claude project audits. A JSON contract specifies required or forbidden files and named MCP declarations. An explicit expectation that fails or remains unknown makes the command exit with status 1.

A2 first ships in the `v0.6.0` source tag. The CLI fixtures cover backend and frontend profiles against two versions of a shared baseline. They check the generated configuration on disk. Generation, adoption and recovery are handled outside ctxharness.

## Product and evidence boundaries

CTX Harness owns configuration diagnosis, documentation drift, attributed static measurements and a reusable export for external consumers. Declaration, supported applicability, observation and estimation remain distinct. Missing evidence stays unknown.

Static byte counts are source measurements. The named historical character estimate is not observed model input. Neither proves saved tokens, authenticated operation, task quality or latency. A filesystem-resolvable tool does not establish client permissions or authentication. Opaque references and digests do not guarantee anonymization.

Session collection/analysis, semantic optimization, controlled before/after experiments, task-quality judges and optimization candidate adoption/recovery belong to a separate project. The existing runtime-evidence importer remains a declaration interface. Existing documentation `fix` and `populate` helpers retain their local behavior.

Completion requires failing-first regression fixtures for defects, targeted and repository checks, real affected CLI verification, contract fixtures, documentation and changelog updates. A local test fixture qualifies that behavior only. This roadmap does not authorize merges, releases, paid experiments or global configuration changes.

The [older design notes](README.md#historical-design-and-implementation-notes) remain historical context. Their version targets, estimates and extended feature ideas are not the active delivery checklist.

## Consumer integration evidence and follow-up

The [CI integration guide](ci-integration.md#observed-integration-case) records three reviewed consumer runs and a separate local profile check. The latest reviewed CI built `0.6.0`, ran documentation/configuration diagnostics as advisory steps and validated its portable report. That job did not supply a profile contract through `--expect`. A green job does not establish clean diagnostics, native client loading or active merge protection.

Proposals from this case are to expose diagnostic outcomes in the Actions summary, exercise an isolated representative profile and verify compiled CLI/core provenance. These are consumer integration recommendations, not implemented consumer changes or a new CTX Harness release scope. The repository remains responsible for generation, test selection and review-bot policy.
