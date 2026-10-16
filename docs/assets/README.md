# README visual assets

[`ctxharness-workflow.png`](ctxharness-workflow.png) is the English README infographic, generated with the built-in `image_gen` tool on 2026-10-15. It is 1672 × 941 pixels. The visual direction follows the dark background, cyan workflow cards and command strip used in the Search Console MCP README; the content describes CTX Harness's own static audit/export workflow.

## Text equivalent

1. **Select:** explicitly choose project or global scope.
2. **Inspect:** diagnose supported documentation, hook and MCP declarations.
3. **Measure:** report source bytes and named estimates.
4. **Export:** produce validated portable JSON.

The example command is `ctxharness doctor --host both --scope project --export portable`. The four footer labels are local checks, static evidence, portable JSON and unknown stays unknown. This depicts the source implementation included in `v0.5.0` and described in [the doctor guide](../doctor.md), not proof of native loading, execution or performance gains. Selection and inspection also cover the supported instruction, skill, rule and agent surfaces listed in [the audit reference](../configuration-audit.md).

The README provides alt text and equivalent capability descriptions. Keep the generated image text consistent with those descriptions; do not add release versions, test counts or measured-savings claims to the image without their own evidence.

<details>
<summary>Exact generation prompt</summary>

```text
Use case: infographic-diagram. Asset type: polished GitHub README hero infographic for the open-source developer CLI CTX Harness. Create a wide 16:9 landscape high-resolution editorial technical infographic, cohesive and exceptionally readable when displayed at 1000 pixels wide. Dark midnight navy background, faint blueprint grid, crisp white sans-serif typography, electric cyan and restrained blue outlines, occasional warm amber accents, clean flat luminous line icons, generous spacing. This matches a professional developer workflow infographic aesthetic, not a dashboard screenshot. All text in English, exact spelling, large type, no invented claims. Top large title: "ctxharness" with ctx in white and harness in cyan. Subtitle: "Check the context your coding agents rely on". Four equally sized horizontal cards connected left to right by simple cyan arrows. Card 1 numbered 1 heading "SELECT", icon showing two document files, caption "Project / global scope". Card 2 numbered 2 heading "INSPECT", magnifying glass over a document and small configuration gear, caption "Docs / hooks / MCP". Card 3 numbered 3 heading "MEASURE", a ruler beside stacked source documents, caption "Bytes / named estimates". Card 4 numbered 4 heading "EXPORT", braces and an outgoing document arrow, caption "Validated portable JSON". Below the cards one slim command strip with exact monospace text: "ctxharness doctor --host both --scope project --export portable". At bottom four evenly spaced small labels: "LOCAL CHECKS", "STATIC EVIDENCE", "PORTABLE JSON", "UNKNOWN STAYS UNKNOWN". All content fully inside safe margins. No robots, mascots, external brand logos, credentials, testimonial, performance graph, token-saving or execution claims. Keep the diagram precise, quiet and legible; no extra text, no watermark.
```

</details>
