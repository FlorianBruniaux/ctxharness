// Production origin: custom domain, DNS and HTTPS verified on 2026-11-19.
export const site = Object.freeze({
  url: 'https://ctxharness.bruniaux.com/',
  name: 'CTX Harness',
  title: 'CTX Harness | Test AI instructions and agent configuration',
  description:
    'Catch stale paths, scripts and versions in CLAUDE.md and AGENTS.md. Audit Claude Code, Codex and MCP configuration locally or in CI, without an LLM.',
  softwareDescription:
    'A deterministic local CLI and TypeScript library for checking AI instruction drift and Claude Code and Codex configuration, without an LLM.',
  image: '/images/infographics/static-workflow.jpg',
  imageAlt:
    'Local agent instructions, configuration and explicit expectations feed deterministic CTX Harness checks, producing findings and a portable report for CI.',
  repository: 'https://github.com/FlorianBruniaux/ctxharness',
})
