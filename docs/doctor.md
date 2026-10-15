# Configuration doctor

Updated: 2026-10-15. Status: behavior present on `main`; this guide does not claim that unreleased changes are available in the published package. [Documentation index](README.md).

## Choose the doctor mode

`ctxharness doctor` reads `.ctxharness.yml`, runs documentation assertions and prints the L1/L2/L3 report. It records the historical documentation score unless `--no-trend` is supplied.

Selecting `--host`, `--scope`, `--format` or `--runtime-evidence` switches to passive agent-configuration diagnosis. This mode does not require `.ctxharness.yml` and does not record trend history.

```bash
ctxharness doctor --host claude --scope project
ctxharness doctor --host codex --scope project --format json
ctxharness doctor --host both --scope project --format gha
```

Use `--root ./path/to/project` to choose a different project. Global selection uses the caller's home directory; it does not infer a remote client's environment. No selected hook, skill, agent or MCP server is executed by the diagnostic.

| Option               | Values                       | Default in configuration mode |
| -------------------- | ---------------------------- | ----------------------------- |
| `--host`             | `claude`, `codex`, `both`    | `both`                        |
| `--scope`            | `project`, `global`, `both`  | `both`                        |
| `--format`           | `human`, `json`, `gha`       | `human`                       |
| `--root`             | Project directory            | Current working directory     |
| `--runtime-evidence` | Explicit local JSON artifact | No runtime import             |

Set `--scope project` when personal configuration is outside the intended audit. For example, `doctor --format json` alone selects both hosts and both scopes. The `run` command has a different format vocabulary: `text`, `json`, `gha`.

## What is inspected

Host adapters select known local roots before discovery. The current adapters include project instruction files, `.claude` configuration, `.codex` configuration and Codex's `.agents/skills` convention. The former `.codex/skills` root remains visible for migration checks. The [Claude adapter](../packages/core/src/agent-config/adapters/claude.ts) and [Codex adapter](../packages/core/src/agent-config/adapters/codex.ts) list the exact roots.

Checks cover instruction presence/shadowing, skill and agent metadata, supported rule declarations, hook fields and locally resolvable command paths, and MCP configuration with credential diagnostics. The global scope also checks the selected shared configuration release and its live projections when release evidence is available.

Applicability is host-specific. An unsupported hook event or handler can produce a warning; an unresolved variable in a command path remains unknown. Inventory presence does not establish native loading, hook trust or an authenticated MCP connection. The import-boundary and malformed-declaration corrections in [PR #11](https://github.com/FlorianBruniaux/ctxharness/pull/11) remain separate from the current `main` implementation.

## Read findings and exit codes

| State            | Interpretation                                                                  |
| ---------------- | ------------------------------------------------------------------------------- |
| `pass`           | The implemented static check passed against the available source.               |
| `warn`           | A diagnostic needs attention without becoming a mandatory static failure.       |
| `fail`           | The check found a failure; a static failure is mandatory in configuration mode. |
| `unknown`        | Required evidence is missing, unresolved or outside the supported observation.  |
| `not-applicable` | The implemented check does not apply to this declaration.                       |

Configuration mode exits 1 when a mandatory static failure exists, and 0 otherwise. Invalid arguments and command errors also exit 1. Exit 0 can contain warnings, unknowns, N/A findings or imported runtime failures; it is not a native-client health certificate.

Human output renders `PASS`, `WARN`, `FAIL`, `UNKNOWN` and `N/A`. Local JSON includes `schemaVersion`, `command`, `mode`, `generatedAt`, `root`, `selection`, `runtimeEvidence`, `summary` and `findings`. Findings retain their `source` (`static` or `runtime`) and `mandatory` flag.

```bash
ctxharness doctor --host claude --scope project --format json > doctor.local.json
```

This local format can contain paths, server names and diagnostic text. Review the artifact before sharing it. The versioned core report parser and disclosure-bounded portable profile proposed in [PR #12](https://github.com/FlorianBruniaux/ctxharness/pull/12) are not exported by current `main`.

## Imported runtime declarations

The existing importer accepts an explicit artifact; it does not collect sessions or run a canary. This is a format example with synthetic values:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-15T00:00:00.000Z",
  "results": [
    {
      "host": "claude",
      "scope": "project",
      "capability": "example-only",
      "status": "unknown",
      "message": "No native observation supplied."
    }
  ]
}
```

```bash
ctxharness doctor --host claude --scope project --runtime-evidence ./runtime-evidence.json --format json
```

Inputs are limited to 1 MB and require version 1 with valid results plus a timestamp or declared signature metadata. Signature metadata is not cryptographically verified. Imported findings remain `source: runtime` and `mandatory: false`; the caller cannot make a runtime failure mandatory through its artifact. Missing or invalid evidence produces an unknown runtime finding.

## Core API and proposed additions

Current core exports include `inventoryAgentConfig`, `scanAgentConfig`, host adapters, `validateAgentConfigRelease` and `checkAgentConfigParity`. The combined doctor report is currently assembled in the CLI. [PR #12](https://github.com/FlorianBruniaux/ctxharness/pull/12) proposes its reusable builder, validators, portable export, declared coverage and static size ledger.

The optional configuration snapshots in [PR #13](https://github.com/FlorianBruniaux/ctxharness/pull/13) have a separate artifact namespace. They do not replace documentation `snapshot`/`diff`. Tool availability in [PR #14](https://github.com/FlorianBruniaux/ctxharness/pull/14) requires caller-selected names and environment evidence; it does not install or execute tools. These flags and commands are not present on current `main`. See [delivery order and product boundary](roadmap.md).
