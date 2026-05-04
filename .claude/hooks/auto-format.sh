#!/usr/bin/env bash
# Runs prettier on TypeScript/Markdown files after write/edit.
set -euo pipefail

FILE_PATH="${CLAUDE_TOOL_INPUT:-}"
CTXHARNESS_ROOT="/Users/florianbruniaux/Sites/perso/ctxharness"

[[ -z "$FILE_PATH" ]] && exit 0
[[ "$FILE_PATH" != "$CTXHARNESS_ROOT"* ]] && exit 0

if [[ "$FILE_PATH" =~ \.(ts|js|json|md|yml|yaml)$ ]]; then
  cd "$CTXHARNESS_ROOT"
  if command -v pnpm &>/dev/null && [[ -f "node_modules/.bin/prettier" ]]; then
    pnpm exec prettier --write --log-level warn "$FILE_PATH" 2>/dev/null || true
  fi
fi

exit 0
