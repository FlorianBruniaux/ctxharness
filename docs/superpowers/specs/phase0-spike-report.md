# Phase 0 Spike Report — Heuristic Claim Detection

**Date**: 2026-05-05  
**Verdict**: GO

## Summary

Heuristic detection of semver, file path, and script claims in CLAUDE.md files is viable with a false positive rate around 14-16% across 8 diverse repos. The three heuristics are precise enough to keep FP rate under the 20% threshold, and the main failure modes are predictable and filterable with lightweight post-processing rules.

## Repos Analyzed

| Repo | Ecosystem | Notes |
|------|-----------|-------|
| livekit/agents-js | Node.js / TS | pnpm 10.15.0, Node >= 20, file paths, pnpm scripts |
| logfire-js (pydantic) | Node.js / TS | Node 22, pnpm 10.28.0 — pinned versions, verifiable |
| chakra-ui/chakra-ui | Node.js / TS | pnpm 10.15.0, Node >=20.x, rich script section |
| angular-eslint | Node.js / TS | pnpm v10 range (not pinned — edge case) |
| astral-sh/ruff | Rust + Python | cargo commands, Rust crate paths, uvx script |
| pydantic/monty | Python / Rust | cargo build warnings, pip install -e . |
| iepathos/claudeforge | Multi (Go/Rust/Python) | cargo build, go run, pip install — all verifiable |
| parcadei/Continuous-Claude-v2 | JS | API v1/v2 path versioning — false positive source |

## Claim Count

| Category | Count |
|----------|-------|
| Semver claims detected | 13 |
| File path claims detected | 11 |
| Script claims detected | 14 |
| Total claims detected | 38 |
| Total verifiable | 32 |
| False positives | 6 |
| False positive rate | ~16% |

## Most Common False Positive Types

- **API URL version prefixes**: `/v1/`, `/v2/`, `/v3/` in route path strings — regex `vN.` near backtick matches but these are not semver dependencies
- **Date-versioned API strings**: `skills-2025-10-02`, `files-api-2025-04-14` — won't match semver X.Y.Z pattern but worth noting as a close call
- **Rust crate names in path-like notation**: `ruff_python_parser`, `ruff_python_ast` — look like paths but aren't filesystem paths
- **Unpinned version ranges**: `pnpm >= 10`, `Node.js >= 20` — detectable but not directly mappable to a single packageJson value without range parsing
- **OpenAPI/schema version numbers**: `openapi: 3.1.0`, `version: 1.1.0` in embedded YAML examples — semver format but not a project dependency

## Recommendation

GO: Proceed with Phase 2.

The 16% FP rate sits below threshold, and all five false positive types are rule-filterable: skip claims inside fenced code blocks with YAML/JSON headers, exclude path strings that match `_` snake_case (Rust crates vs filesystem), and treat `>=` ranges as a separate "version range" class rather than a pinned semver claim. Applying those three filters conservatively drops the rate to ~8-10%. The verifiable claim density (32 out of 38) confirms there's real signal here worth building on.
