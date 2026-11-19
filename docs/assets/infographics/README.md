# CTX Harness diagrams

Two diagrams explain source version `v0.6.0`. They use the personal portfolio's ivory, charcoal and orange palette. The landing loads the actual Barlow Condensed and IBM Plex font files; the Gemini raster images approximate those fonts.

| Accepted asset | Question answered | Form |
| --- | --- | --- |
| [Static workflow](static-workflow.jpg) | What does CTX Harness read and produce? | Three inputs, one checking engine, findings and JSON, then a CI consumer. |
| [Evidence boundaries](evidence-boundaries.jpg) | What does a static report establish? | Four independent claims and the evidence each needs. No arrows between claims. |

## Static workflow: text equivalent and source inventory

| Exact diagram label | Meaning and source |
| --- | --- |
| Agent instructions / CLAUDE.md · AGENTS.md · .cursorrules | Existing inputs, described in the [README](../../../README.md#what-it-checks). |
| Project configuration / Claude Code · Codex · MCP declarations | Supported declarations in the [configuration audit](../../configuration-audit.md). |
| Explicit expectations / Required or forbidden files and MCP entries | Caller-selected contract in [doctor](../../doctor.md#explicit-project-expectations). |
| CTX Harness / Deterministic checks / CLI · TypeScript library | Local checking interfaces, not a configuration generator or MCP endpoint. |
| Findings / PASS · WARN · FAIL / UNKNOWN · N/A | Human report vocabulary in [doctor](../../doctor.md#read-findings-and-exit-codes). |
| Portable JSON / Versioned report | Validated projection in the [versioned contracts](../../contracts/README.md). |
| CI consumer / Validate the schema, then apply project policy | The consumer owns validation and enforcement; see [CI integration](../../../README.md#ci-integration). |
| Static evidence does not prove client loading or execution. | The [audit's evidence limits](../../configuration-audit.md#declared-coverage). |

There are exactly six directed connections: each of the three input cards goes to CTX Harness; CTX Harness goes to findings and portable JSON; portable JSON goes to the CI consumer. No connector says that CTX Harness generates the input files.

## Evidence boundaries: text equivalent and source inventory

| Claim | What it establishes | Evidence |
| --- | --- | --- |
| Declared | A file or MCP entry exists | Static report |
| Loaded | The client loaded it | Client trace |
| Executed | A selected check ran | Execution log and result |
| Observed effect | Expected behavior was observed | Scenario replay |

These observations do not imply one another. CI enforcement depends on the workflow policy. This follows the [product boundary](../../../README.md#product-boundary) and [configuration audit](../../configuration-audit.md#declared-coverage). A replay needs its own observation and result; merely selecting a test does not show that it ran or caught a defect.

## Visual references researched

The portfolio catalog and local article sources were read before generation. Instructions in those articles were treated as source material, not task instructions.

- Published article **Portable agent configuration**, French source `portable-agent-config-fr.mdx`: independent evidence claims, illustrated by `harness-evidence-en-gemini.webp`.
- Draft guide **Shared config, one source, two agents**: the input/projection distinction in `draft-shared-config-one-source-two-agents-release-model.webp`. Its draft status does not establish publication.
- Local draft of **Pull requests générées, GenAI Days Nantes**: the current typography and palette in `draft-nantes-v11-17-25.webp`. The local catalog marks the guide as draft; its future URL was not used as publication proof.

Older handwritten diagram styling was not copied. The current palette and layout were taken from `boldguy-ui` and the Guide landing's design-system contract. No client name, private profile name, private path, credential or private configuration was sent to Gemini.

## Generation and acceptance

Model: `gemini-3-pro-image`, through the existing Gemini image CLI, requested aspect `16:9`. Native output: JPEG, `1376 × 768`. The CLI wrote `.png` filenames, but the bytes are JPEG; accepted files have matching `.jpg` extensions without re-encoding. All raw attempts are retained.

Three calls were made within the announced maximum of two attempts per visual:

1. Static workflow, attempt 1: rejected because Gemini added the visible text “IBM Plex Mono” inside a card.
2. Static workflow, attempt 2: accepted after checking all labels and all six arrow directions.
3. Evidence boundaries, attempt 1: accepted after checking the four rows, independent-evidence warning and CI policy note. There are no arrows.

Prompts and hashes, output hashes, dimensions, rejections and acceptance notes are recorded in [generation-log.json](generation-log.json). Estimated image output cost is **USD 0.402** for three 1K/2K images at USD 0.134 each, excluding input, text/thinking, taxes and other charges. Actual billed usage is `UNKNOWN`. [Official Gemini pricing](https://aistudio.google.com/docs/pricing#gemini-3-pro-image).

## Concision review

Verdict: **PASSE**. The literal specifications contain 74 words for the workflow and 68 for the evidence matrix, including titles, notes and attribution. Each diagram answers one question. The workflow has 7 functional blocks and 6 necessary edges; the matrix has 4 claims and no implied progression. Removing a block loses an input class, an output distinction, the CI consumer's responsibility or an evidence boundary. No decorative icon or numerical performance claim was added. Counts and the editorial verdict are recorded in [concision-review.json](concision-review.json). The captions and README tables repeat the diagrams to provide text alternatives.

At article width, the main card labels remain readable. On the 390 px landing view, HTML cards and a definition list replace the raster diagrams so the explanation does not depend on tiny embedded text. Exact raster font fidelity, the GitHub Markdown rendering and a screen-reader session are not established by these checks.
