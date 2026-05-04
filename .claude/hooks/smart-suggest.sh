#!/usr/bin/env bash
# Suggests relevant slash commands based on prompt keywords.
set -euo pipefail

PROMPT="${CLAUDE_TOOL_INPUT:-}"
[[ -z "$PROMPT" ]] && exit 0

P="${PROMPT,,}"

if [[ "$P" =~ (commit|ship|release) ]]; then
  echo "systemMessage: Tip — use /commit for conventional commit formatting." >&2
fi

if [[ "$P" =~ (extractor|scanner|add.*check|new.*assertion) ]]; then
  echo "systemMessage: Tip — see CLAUDE.md 'Adding an extractor/scanner' section for the 4-step process." >&2
fi

if [[ "$P" =~ (publish|npm|registry) ]]; then
  echo "systemMessage: Tip — run \`pnpm build && pnpm test\` before publishing. Tag with \`git tag vX.Y.Z\` first." >&2
fi

exit 0
