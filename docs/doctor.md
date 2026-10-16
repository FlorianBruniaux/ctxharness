# Configuration doctor

Updated: 2026-10-16. Status: behavior included in source version `0.5.0`. A Git tag does not establish npm package publication; verify the version of an installed CLI. [Documentation index](README.md).

## Choose the doctor mode

`ctxharness doctor` reads `.ctxharness.yml`, runs documentation assertions and prints the L1/L2/L3 report. It records the historical documentation score unless `--no-trend` is supplied.

Selecting `--host`, `--scope`, `--format`, `--runtime-evidence`, `--coverage`, `--budget`, `--export` or any tool option switches to passive agent-configuration diagnosis. This mode does not require `.ctxharness.yml` and does not record trend history.

```bash
ctxharness doctor --host claude --scope project
ctxharness doctor --host codex --scope project --format json
ctxharness doctor --host both --scope project --format gha
```

Use `--root ./path/to/project` to choose a different project. Global selection uses the caller's home directory; it does not infer a remote client's environment. No selected hook, skill, agent or MCP server is executed by the diagnostic.

| Option               | Values                           | Default in configuration mode     |
| -------------------- | -------------------------------- | --------------------------------- |
| `--host`             | `claude`, `codex`, `both`        | `both`                            |
| `--scope`            | `project`, `global`, `both`      | `both`                            |
| `--format`           | `human`, `json`, `gha`           | `human`                           |
| `--root`             | Project directory                | Current working directory         |
| `--runtime-evidence` | Explicit local JSON artifact     | No runtime import                 |
| `--coverage`         | Include declared static coverage | Omitted unless exporting portable |
| `--budget`           | Include attributed static sizes  | Omitted unless exporting portable |
| `--export`           | `portable`                       | No portable projection            |

Set `--scope project` when personal configuration is outside the intended audit. For example, `doctor --format json` alone selects both hosts and both scopes. The `run` command has a different format vocabulary: `text`, `json`, `gha`.

## What is inspected

Host adapters select known local roots before discovery. The current adapters include project instruction files, `.claude` configuration, `.codex` configuration and Codex's `.agents/skills` convention. The former `.codex/skills` root remains visible for migration checks. The [Claude adapter](../packages/core/src/agent-config/adapters/claude.ts) and [Codex adapter](../packages/core/src/agent-config/adapters/codex.ts) list the exact roots.

Checks cover instruction presence/shadowing, skill and agent metadata, supported rule declarations, hook fields and locally resolvable command paths, and MCP configuration with credential diagnostics. The global scope also checks the selected shared configuration release and its live projections when release evidence is available.

Applicability is host-specific. An unsupported hook event or handler can produce a warning; an unresolved variable in a command path remains unknown. Inventory presence does not establish native loading, hook trust or an authenticated MCP connection. Imported context reads stay within caller-selected roots and reject special files without blocking. Malformed supported hook declarations fail before event semantics; numeric MCP resource limits are distinguished from literal credentials. See [the audit rules and limits](configuration-audit.md).

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

This local format can contain paths, server names and diagnostic text. Review the artifact before sharing it. The portable profile omits paths, names, arbitrary messages, credentials and signature metadata; opaque references and counts can still identify an installation.

```bash
ctxharness doctor --host both --scope project --export portable > doctor.portable.json
ctxharness doctor --host claude --scope project --coverage --budget --format json
```

Portable export includes coverage and static sizes by default. Local JSON adds those fields only when requested. Coverage retains declared applicability and unresolved/unsupported surfaces; native loading, execution and benefit remain unknown. The ledger measures discovered UTF-8 bytes and UTF-16 code units, with the historical `ceil(codeUnits / 4)` estimate. Completeness describes bounded traversal, not a complete model request. See [the schemas and sanitized consumer fixtures](contracts/README.md).

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

## Core API

Core exports `buildAgentDoctorReport`, `AgentDoctorReportSchema`, `parseAgentDoctorReport`, `projectPortableReport`, `PortableReportSchema` and `parsePortableReport`. Callers explicitly select project root, home, hosts and scopes. `includeCoverage` and `includeBudget` opt into the extensions. The builder works without a CLI process; existing inventory, scanner, release and parity exports remain available. Validate untrusted artifacts and reject unsupported versions rather than migrating implicitly.

## Optional configuration snapshots

```bash
ctxharness config-snapshot --host claude --scope project --output first.json
ctxharness config-snapshot --host claude --scope project --output second.json
ctxharness config-diff first.json second.json
```

`config-snapshot` requires an explicit new output path, defaults to project scope and writes a separate `ctxharness-config-snapshot` v1 artifact, limited to 8 MiB. Existing files are never overwritten. `config-diff` compares artifacts without rescanning or changing a baseline: exit 0 for a valid equal/changed result, 2 for an incomparable or invalid input. These commands preserve the historical documentation `snapshot`/`diff` behavior.

Snapshots include static findings and opaque source/content/root digests, excluding imported runtime results and tool diagnostics. Digests do not guarantee anonymization. Root selections and profile versions must be compatible. Structural equality and traversal completeness are separate; neither proves native loading or performance. Core exposes the builder, parser, schema, save/load and comparator listed in [the snapshot contract](contracts/README.md#optional-snapshot-artifact).

## Optional tool availability

```bash
ctxharness doctor --host claude --scope project --tools rg,gh --tool-path /opt/example/bin --tool-environment declared-client --format json
```

The PATH above is an example supplied by the caller. `--tools` selects comma-separated names; every other tool option requires this list. Results remain `unknown-client-environment` without both a declared client PATH and identity. The diagnostic never substitutes this shell's PATH, executes binaries, probes versions/authentication or installs tools. An `installed` result establishes filesystem resolution and executable access only; authentication and client permissions stay unknown.

| Option               | Values or purpose                                  | Default                                      |
| -------------------- | -------------------------------------------------- | -------------------------------------------- |
| `--tool-path`        | Declared client PATH                               | Unspecified                                  |
| `--tool-environment` | Declared client identity                           | Unspecified                                  |
| `--tool-platform`    | `posix`, `win32`                                   | `posix`; Windows remains unsupported/unknown |
| `--tool-cwd`         | Client working directory for relative PATH entries | Unspecified                                  |
| `--tool-symlinks`    | `reject`, `follow`                                 | `reject`                                     |
| `--required-tools`   | Required names, a subset of `--tools`              | No project requirement                       |

Portable output omits names, environment identity, PATH entries and resolved executable paths. Missing-tool advice requires an explicit requirement; no universal tool list is recommended. The shared optional v1 data contract remains consumable by the foundation-only parser. Core callers opt in with `toolRequest` or use `diagnoseToolAvailability` directly. See [delivery status and product boundary](roadmap.md).
