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
