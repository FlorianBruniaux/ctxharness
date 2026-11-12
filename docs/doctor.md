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

## Explicit project expectations (unreleased)

`--expect` adds caller-selected presence/absence requirements to the passive diagnostic. It currently requires explicit `--host claude --scope project`. It does not select a developer profile, regenerate configuration, execute a check or observe a native client.

Create a JSON artifact such as `backend.expectations.json` outside the configuration being generated:

```json
{
  "schemaVersion": 1,
  "host": "claude",
  "scope": "project",
  "expectations": [
    {
      "id": "design-rule",
      "kind": "file",
      "path": ".claude/rules/design.md",
      "state": "absent"
    },
    {
      "id": "design-mcp",
      "kind": "mcp-server",
      "path": ".mcp.json",
      "name": "design_fixture",
      "state": "absent"
    }
  ]
}
```

From the project root, with a CLI built from source containing this feature:

```bash
ctxharness doctor --host claude --scope project --expect backend.expectations.json --format json
```

The contract path resolves from the caller's working directory. Target paths resolve from `--root` (or the current directory). No contract is discovered implicitly. `.ctxharness.yml` remains the configuration format for documentation assertions; this explicit JSON artifact describes the expectations for one audit.

`kind: file` checks a named regular readable file or the absence of any entry at that path. `kind: mcp-server` checks an own property of the `mcpServers` object in the project's `.mcp.json`. It does not infer tool exposure, authentication or permissions. A certainly missing MCP file satisfies a server-absence expectation. Invalid JSON, a missing or non-object `mcpServers`, and a non-object entry for the named server remain unknown.

Contracts accept 1–100 expectations with unique IDs and targets. IDs and MCP names use 1–64 ASCII letters, digits, dots, underscores or hyphens. File paths are relative, up to 512 characters, without empty, dot or parent segments, backslashes, colons or NUL characters. MCP expectations use only `.mcp.json`. Unknown fields and versions are rejected. The contract and each required file read are limited to 1 MB. Imports are not followed. Symlinks on target paths are not followed, including links inside the project. A forbidden final symlink is an existing entry and fails an absence requirement. Unreadable parents and ambiguous missing paths remain unknown. Audit a stable tree; these checks are not a filesystem sandbox against concurrent writers.

Individual results use `capability` for the expectation ID and retain `pass`, `fail` or `unknown`. The aggregate `config-expectations-unsatisfied` finding fails when any explicit expectation fails or remains unknown, producing exit 1. All expectations passing removes only this contract's failure; other mandatory static failures still produce exit 1. Unknowns unrelated to the contract and imported runtime declarations keep their existing behavior. Invalid contracts or incompatible selections also exit 1 without a success report.

Expectation results do not add discovered resources to coverage or budget. The local report keeps schema v1. Portable v1 maps the new codes to `unrecognized-finding`, preserving statuses and counts while omitting IDs, paths and values. Use local JSON to correlate individual requirements. Configuration snapshots remain separate: the snapshot CLI does not accept `--expect` and does not include this evaluation.

The [profile fixture](../packages/core/src/agent-config/__fixtures__/profile-expectations/) exercises A/backend, A/frontend, B/backend and B/frontend, profile round trips, idempotence, a support-file rename with identical bytes and a preserved local override. Independent test assertions check changed contents and intentionally demonstrate that presence alone can pass with stale content. The fixture does not run ai-rulez, Claude, a check script or an MCP server. Its prepared B-to-A transition is an observer test, not a transactional rollback implementation.

Core consumers can use `ConfigExpectationsSchema`, `parseConfigExpectations`, `loadConfigExpectations` and `checkConfigExpectations`, or pass parsed `expectations` to `buildAgentDoctorReport` with exactly the Claude project selection.

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
