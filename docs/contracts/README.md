# Configuration contracts

Core exports `buildAgentDoctorReport(options)`, `AgentDoctorReportSchema` and
`parseAgentDoctorReport(unknown)`. Options explicitly select root, home, hosts and
scopes. The local doctor v1 fields, findings, summary and mandatory-failure exit
policy remain unchanged. The library needs no CLI process. Runtime input is still
optional, bounded to 1 MB, and separate from static findings. Declared signatures
are metadata, never verified signatures or proof of native effects.

`doctor --host claude --scope project --export portable` writes portable JSON.
`PortableReportSchema`, `parsePortableReport(unknown)` and
`projectPortableReport(localReport)` expose the same contract in core.

| Field                                 | Contract                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| schemaVersion / kind / profileVersion | `1` / `ctxharness-portable` / `1`                                                                |
| selection                             | Unique supported host and scope enums                                                            |
| summary                               | Nonnegative integer counts recomputed against findings                                           |
| runtimeEvidence                       | `not-provided`, `unavailable`, `timestamped`, `declared-signature`                               |
| findings                              | Unique opaque `fN` reference, bounded code, status, source, mandatory, optional host/scope/layer |

The closed code vocabulary lives in `PortableCodeSchema`; unrecognized local codes
map to `unrecognized-finding`. All objects reject extra keys, unsupported versions,
inconsistent counts and mandatory imported-runtime findings. An unknown local
finding must state its evidence reason. Portable strings are enums or generated
references. Paths, names, arbitrary messages, credentials, command arguments and
signature metadata are excluded by construction. `buildPrivateSourceMap` is an
explicit local-only helper. Never share it with the portable payload. Opaque
references do not guarantee anonymization: counts and configuration patterns may
still identify an installation.

The sanitized JSON fixtures here are importable without invoking the CLI:
[valid v1](portable-v1.valid.json), [inconsistent counts](portable-v1.invalid.json)
and [unsupported version](portable.unsupported.json). Consumers must validate
before use. Unsupported versions are rejected, with no implicit migration.
Changes to existing semantics require a new schema/profile version; additive
optional extensions must be documented. There is no dependency on an optimizer.

Portable CLI failures write only the bounded export error envelope to stderr and
return 1. A valid report also returns 1 when static mandatory failures exist.
Reports describe static observations and imported declarations; they establish no
native loading, authentication, task quality, resource saving or cache benefit.

## Coverage extension

Optional `coverage` uses profile version 1 and partial resolution. Its portable
items contain generated `cN` references, host/scope/layer enums, bounded state
arrays and unknown loaded/executed/beneficial states. The support matrix uses
closed surface/status enums. Local paths and provenance are omitted. Schemas are
`ConfigCoverageSchema` and `PortableCoverageSchema`; unsupported native/platform
qualification remains explicit.

## Static budget extension

Optional `budget` uses profile 1 and `discovered-content-only` scope. Every size
contains UTF-8 bytes, UTF-16 code units and their named chars/4 estimate. Portable
files carry bounded segments/attributions and opaque physical/content group refs;
raw paths, content and content digests are excluded. `StaticBudgetSchema` and
`PortableBudgetSchema` reject inconsistent totals and estimates. `complete` refers
to bounded traversal, not complete model request observation.

Budget validation also checks segment sums, unique file/physical references,
retained edge targets and the consistency of `complete` with traversal outcomes.
Non-text sources remain explicit incomplete edges without dangling references.
Local ledgers retain discovered physical aliases in `paths` and union attribution
across all import parents. The portable projector omits aliases and paths.

The foundation v1 validators reserve a typed optional `toolAvailability` field.
`ToolAvailabilitySchema`, `PortableToolsSchema` and `portableToolAvailability`
are pure data contracts; no filesystem diagnostic runs in the foundations.
`portable-tools-v1.valid.json` is an extension-bearing v1 consumer fixture.
Unknown fields, raw tool identities and personal environment data remain rejected
by the portable validator. The optional extension supplies diagnosis separately.


## Optional tool availability extension

`diagnoseToolAvailability` accepts explicit tools and a caller-declared environment.
`ToolAvailabilitySchema` validates local results; `PortableToolsSchema` and
`portableToolAvailability` retain only bounded resolution states/reasons, requirement
kinds, generated `tN` references and unknown authentication/permissions. Neither
PATH entries, tool names, environment identity nor raw failures are exported.
The report builder's `toolRequest` option and doctor's `--tools` flag opt in.
