# CI evidence copy revision

Updated: 2026-11-18. Local documentation revision only.

The user supplied an audit of consumer PRs and CI logs. The public case stays anonymized. Source PR/run links and the full audit remain in the private local proof notes, outside this repository. This revision did not repeat those remote checks.

## Changes

The landing now separates the reviewed CI diagnostics, portable validation and local profile check. It states that the CI job did not pass `--expect`, that two diagnostic commands exited `1` while their steps stayed advisory, and that active merge protection was not established. A FAQ explains why a green job can contain failed diagnostics.

The repository adds [CI integration guidance](../../docs/ci-integration.md), linked from the root README, documentation index, doctor guide, roadmap and contributor instructions. The source-build instructions pin pnpm to `10.11.0`, as the composite Action already does. The changelog records a documentation change, without a version bump or a consumer-workflow implementation claim.

## Local verification

- Sixteen demo tests passed, including the six engine/API checks and ten design guard checks.
- System Chrome passed the existing full-page checks at 1440 px light, 1440 px dark and 390 px light. Horizontal overflow was zero, logo/h1 alignment difference was zero and minimum measured HTML text contrast was 4.92:1. Existing IDs, links, interaction attributes and SEO metadata were preserved.
- The exact portable-parser example, with only its import path relocated to the released core dependency, accepted clean and failed-but-valid reports. It rejected malformed JSON, an unsupported schema and inconsistent counts.
- The YAML fragment parsed, and its summary shell snippet rendered success, advisory failure and skipped outcomes locally. No GitHub workflow was launched for these examples.
- Relative documentation links and heading anchors passed. The new guide is referenced by its index, and no catalogue generator is configured for this repository.
- `git diff --check` passed. User configuration files, CSS, demo scripts, package manifests and lockfile match their relevant preimages or Git baseline.

The global pnpm invocation used for an optional format check unexpectedly started installation and removed dependency links before fetches failed. It was interrupted. Dependencies were restored with cached pnpm `10.11.0`, `--offline --frozen-lockfile --ignore-scripts`: 156 packages reused, zero downloaded. The CLI again reported `0.6.0` and the local core parser passed its fixture check. The new guide was formatted by invoking the restored Prettier entry point directly.

## Render verdict and limits

`boldguy-design-critic` validated the three changed-block captures, with no visual blocker. It found the distinctions readable and no identifiable consumer repository, client or profile name in those captures. Its review did not verify the source audit's numbers or remote runs, and did not include expanded FAQ answers. The automated browser checks separately exercised every FAQ disclosure.

This revision does not establish deployment, GitHub Markdown rendering, active server-side merge rules, native client loading, other browser engines or a screen-reader session. Contrast checks cover HTML text, not the pixels of existing diagrams. The pre-existing local favicon 404 remains outside this copy revision.
