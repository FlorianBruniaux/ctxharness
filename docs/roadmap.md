# Configuration audit and export roadmap

Updated: 2026-10-15. Status checked against [roadmap #10](https://github.com/FlorianBruniaux/ctxharness/issues/10) and its PRs on that date. [Documentation index](README.md).

## Current delivery status

`main` contains documentation-drift commands and passive Claude Code/Codex configuration diagnosis. Both packages declare version `0.4.6`; this alone does not establish which unreleased commits a published installation contains. Consult [the doctor guide](doctor.md) for the current source behavior and [the changelog](../CHANGELOG.md) for release history.

The following implementations are open draft PRs, not merged features or published releases:

| Order              | Issues                                                                                                                                                                                   | Proposed behavior                                                                                                | PR and base                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1                  | [#2](https://github.com/FlorianBruniaux/ctxharness/issues/2), [#3](https://github.com/FlorianBruniaux/ctxharness/issues/3), [#4](https://github.com/FlorianBruniaux/ctxharness/issues/4) | Bound imported reads, validate malformed hook declarations and distinguish MCP resource limits from credentials. | [#11](https://github.com/FlorianBruniaux/ctxharness/pull/11), based on `main` |
| 2                  | [#5](https://github.com/FlorianBruniaux/ctxharness/issues/5)                                                                                                                             | Reusable doctor contract and validated portable export.                                                          | [#12](https://github.com/FlorianBruniaux/ctxharness/pull/12), based on #11    |
| 3                  | [#6](https://github.com/FlorianBruniaux/ctxharness/issues/6)                                                                                                                             | Declared coverage, explicit unsupported surfaces and unresolved evidence.                                        | #12                                                                           |
| 4                  | [#7](https://github.com/FlorianBruniaux/ctxharness/issues/7)                                                                                                                             | Attributed static size ledger and named estimation methods.                                                      | #12                                                                           |
| Optional extension | [#8](https://github.com/FlorianBruniaux/ctxharness/issues/8)                                                                                                                             | Separate configuration snapshots and deterministic structural comparisons.                                       | [#13](https://github.com/FlorianBruniaux/ctxharness/pull/13), based on #12    |
| Optional extension | [#9](https://github.com/FlorianBruniaux/ctxharness/issues/9)                                                                                                                             | Explicit filesystem tool availability without installation or execution.                                         | [#14](https://github.com/FlorianBruniaux/ctxharness/pull/14), based on #12    |

Review #11 before #12. Review #13 and #14 independently against #12; neither optional extension blocks the audit/export foundation. The branches are `codex/roadmap-foundations`, `codex/roadmap-contract`, `codex/config-snapshots` and `codex/tool-availability` respectively. Each PR carries its own validation results and implementation documentation.

The proposed `--export portable`, `--coverage`, `--budget`, tool options, `config-snapshot` and `config-diff` must not be presented as commands available on `main` before their implementation is integrated. The historical documentation commands and output formats remain compatibility requirements.

## Product and evidence boundaries

CTX Harness owns configuration diagnosis, documentation drift, attributed static measurements and a reusable export for external consumers. Declaration, supported applicability, observation and estimation remain distinct. Missing evidence stays unknown.

Static byte counts are source measurements. The named historical character estimate is not observed model input. Neither proves saved tokens, authenticated operation, task quality or latency. A filesystem-resolvable tool does not establish client permissions or authentication. Opaque references and digests do not guarantee anonymization.

Session collection/analysis, semantic optimization, controlled before/after experiments, task-quality judges and optimization candidate adoption/recovery belong to a separate project. The existing runtime-evidence importer remains a declaration interface. Existing documentation `fix` and `populate` helpers retain their local behavior.

Completion requires failing-first regression fixtures for defects, targeted and repository checks, real affected CLI verification, contract fixtures, documentation and changelog updates. A local test fixture qualifies that behavior only. This roadmap does not authorize merges, releases, paid experiments or global configuration changes.

The [older design notes](README.md#historical-design-and-implementation-notes) remain historical context. Their version targets, estimates and extended feature ideas are not the active delivery checklist.
