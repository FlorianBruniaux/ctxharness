# Configuration audit

CTX Harness diagnoses configuration and documentation drift. Session analysis,
controlled experiments and candidate application belong to external consumers.

## Selected filesystem reads

`contextBudget` and `scanFile` follow local `@file.md` imports within caller-owned
roots, including resolved symlink targets. Scanner arguments cannot expand roots.
`runScanner` accepts an optional fifth `ReadPolicy` argument; existing synchronous
plugins and four-argument calls remain supported. Direct calls default to the
file's directory; the runner passes the selected project root separately.
`scanFileWithCoverage` exposes completeness and local import edges, while
`scanFile` retains its historical array result. The CLI reports incomplete reads.

Traversal deduplicates device/inode identity, retains provenance edges, and caps
reads at 256 files, 4 MiB, 4096 edges and depth three in legacy scanners. Caller
policies may lower caps; the core traversal depth ceiling is 32. Missing,
disappearing, unsupported, out-of-boundary and capped sources remain incomplete.
Cycles and repeated physical files are deduplicated, not evidence of repeated
injection. Explicit callers may select project/global roots; documents cannot.

These checks require a stable tree. They are not an OS sandbox against hostile
concurrent writers between path resolution and opening. Qualification uses inert
fixtures. No imported content is executed.

Special files (including named pipes) are rejected without waiting for a writer.
Imports are traversed in breadth-first order, so a physical file first reached
through a longer chain cannot hide descendants reachable through a shorter one.
Hardlinks share one measured body, while imports are resolved from each distinct
location. Repeated locations and cycles terminate without discarding alias edges.

The historical `contextBudget` output strings and configurable threshold (default
3000) remain local policy. The estimate is `ceil(UTF-16 code units / 4)`, not an
observed model request or a universal quality threshold.

## Hook shapes

Omitted hooks produce no declaration finding; an explicit empty object reports
`hook-config-empty`. Invalid containers, groups, matcher types and missing handler
fields report `hook-config-invalid` as mandatory static failures. Commands require
a nonempty command and optional string-array args; HTTP requires a URL string,
MCP handlers require server/tool strings, prompt/agent handlers require a prompt.
Unsupported types/events remain warnings about unresolved applicability. Discovery
and path resolution do not establish trust, activation or native effect.

## MCP credentials

Numeric `--max-tokens` and `--token-budget` args (separate or `=` forms) are
resource limits. Other token-like options, nonnumeric values, literal keys, bearer
headers and literal environment fallbacks still undergo credential checks.
Findings never serialize the matched credential. No MCP server is executed.

## Reusable export

See the [versioned configuration contracts](contracts/README.md) for the local
report, portable projection, schemas, sanitized fixtures and disclosure limits.

## Declared coverage

`doctor --coverage --host both --scope project --format json` adds a versioned
coverage extension. Portable exports include it by default. Core callers opt in
with `includeCoverage: true` or use `buildConfigCoverage(inventory)` directly.
The legacy report without these options retains its fields.

Items carry source provenance and explicit discovered, declared, statically
applicable, conditional, shadowed, invalid, outside-selection or unresolved
states. Root instructions and Codex override shadowing use the existing static
host profiles. Directory-specific instructions, rule globs, skills and agents
remain conditional; a rare glob with no current file match remains useful.
Hooks/MCP declarations do not establish trust or invocation. Project/global
sources retain their provenance; repeated requested roots are deduplicated.
Skill checks cover manifest metadata and declared reference existence, not a
native client's resource loading or effective catalog serialization.

The support inventory explicitly marks memory, Output Styles, plugin manifests,
command manifests and managed settings unsupported. Codex imports and Claude-style
rule globs are unsupported by this profile. Release support is unobserved here.
Resolution remains partial; native client and platform qualification are
unobserved/unqualified. Every item's loaded, executed and beneficial states remain
unknown. No session trace is collected or needed to retain a conditional rule.

## Static source sizes

`doctor --budget --host claude --scope project --format json` adds the static
ledger; portable export includes it by default. Core exposes
`buildStaticBudget(inventory, limits)` and report option `includeBudget: true`.
Sizes cover discovered content only, under the same caller-owned read boundaries.

The ledger separately labels exact UTF-8 bytes, JavaScript UTF-16 code units and
`ceil(codeUnits / 4)`. It preserves the historical character estimate rather than
substituting bytes/4. Each physical artifact is traversed once, with import edges
retained. Different files with equal content share a content-group marker; this
is an equality signal, not proof of duplicate injection.

Attribution separates instruction bodies, conditional rules, skill manifest
metadata and bodies, agent bodies, hook configuration and discoverable MCP
metadata. Catalog metadata measures source frontmatter, not native prompt
serialization. A server declaration reveals no full tool-schema payload. Shared
physical configurations retain multiple host/scope/layer attributions. Missing,
non-text, inaccessible and capped content makes the traversal incomplete.

Portable ledgers contain bounded categories, methods, counts and opaque group/file
references. Local paths and content digests stay local. Hidden prompts, loading and
request assembly remain unknown. The ledger calculates no saved tokens, money,
quality, provider cache effect or before/after result.
