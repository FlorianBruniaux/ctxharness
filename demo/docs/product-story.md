# Explain CTX Harness before the backend demo

For developers and maintainers using coding agents, who need to decide whether to try CTX Harness on a repository.

Core message: **CTX Harness checks AI instructions and configuration against local files so drift produces repeatable findings.**

Three supporting facts, verified against the repository README and doctor guide:

1. `README.md#what-it-checks` and `#quick-start`: scan documented paths, npm scripts and versions; configure repeatable documentation assertions.
2. `README.md#configuration-doctor` and `docs/doctor.md#what-is-inspected`: inspect supported Claude Code and Codex declarations with explicit host and scope selection.
3. `README.md#check-an-explicit-profile-contract` and `docs/doctor.md#explicit-project-expectations`: require or forbid named files and MCP declarations; unresolved explicit requirements fail the selected contract.

The opening pitch is one headline and one explanatory paragraph. Six chapters supply the requested detail. This is a landing page, so slide word limits do not apply. Release history, the full extractor/scanner catalog and research claims remain in the README rather than competing with the opening explanation.

## Reading order

1. Problem, documentation and agent configuration drift after changes.
2. Diagram, selected files → deterministic checks → evidence.
3. Capabilities, documentation checks, configuration audits and explicit profiles, followed by source sizes and exports.
4. Existing interactive backend example, with the scope of the rule explained first.
5. Diagram, change → local check → CI → report, with documentation Action and profile CLI kept distinct.
6. Try it locally, source install and the same explicit expectation contract.

Keywords appear in useful context: context engineering, AI instruction testing, documentation drift, configuration drift, agent harness, Claude Code, Codex, CLAUDE.md, AGENTS.md, MCP, deterministic CLI, CI, TypeScript and portable JSON. No external search-volume claim is made.

## Scope

This request authorizes narrative and page structure changes after the earlier visual-only review. Existing IDs, external URLs, client scripts, API, fixtures and SEO head remain intact. Internal chapter links are added. The current v0.6.0 source install is shown rather than asserting a successful npm publication. No commit, push or production deployment is authorized by this revision.

## Editorial review

Verdict: **PASS**. The opening explains the purpose before introducing the backend example. The problem, the CLI/library form, the three core workflows and the scope of evidence are identifiable from the headings and opening paragraphs.

Measured with the critique-concision script: 1,035 visible words, 22 content blocks, six numbered chapters and two diagrams. The first expanded draft measured 1,068 words. Repeated examples in the opening and generic capability-introduction copy were cut. The remaining detail serves a requested capability, example, usage step or evidence boundary. The FAQ retains the no-LLM answer as a directly accessible question.

This is a substantive landing page, so the slide-oriented word-limit warnings are not applied as page limits. The large title count includes example cards, diagram nodes and FAQ-support headings. No measured task-quality, savings, latency or search-volume claim was added.

## Final verification

- Six ChapterLabels, two responsive diagrams, one orange band, alternating main-section surfaces.
- System Chrome at 1440 light, 1440 dark and 390 light. Horizontal overflow 0px, h1/logo alignment offset 0px, minimum computed text contrast 4.92:1.
- All 20 visible links, buttons and summaries are at least 44px and reachable by keyboard with a visible 2px focus outline. Reduced-motion preferences disable transitions and animations.
- Every FAQ answer opens visibly without overflow. The hero link reaches the backend demo. Clipboard and contract download still work. PASS, FAIL and UNKNOWN still match the selected scenarios in all three views.
- Existing IDs, external link destinations/labels, interaction ARIA/data attributes and SEO head are preserved. Frontend script, API and fixture files are byte-identical to the saved pre-revision sources.
- The displayed local command was extracted from the HTML, its documented source-checkout placeholder substituted, and run with the 0.6.0 build in a new Git repository. The clean case exits 0/pass, design declaration exits 1/fail, invalid JSON exits 1/unknown. This proves the source-build command, not an npm registry npx install.
- The 16 demo tests, including the zero-budget design guard, pass. Existing core/CLI production sources were not changed in this revision.
- Independent rendered review by `boldguy-design-critic`: **VALIDATED**, no visual blocker. The product scope is explained before the backend example; both diagrams adapt to mobile.

Proofs and before/after screenshots are stored in `local session proof directory (not distributed)`, including `verification.json` and `cli-command-check.json`.

Not verified in this revision: Safari, Firefox, a physical mobile device, screen reader, 200% zoom, mobile dark, production deployment and npm registry installation. The local server's pre-existing automatic favicon request still returns 404. No commit, push or production deployment was performed.
