#!/usr/bin/env bash
# Runs tsc after editing .ts files and surfaces errors as a system message.
set -euo pipefail

FILE_PATH="${CLAUDE_TOOL_INPUT:-}"
CTXHARNESS_ROOT="/Users/florianbruniaux/Sites/perso/ctxharness"

[[ -z "$FILE_PATH" ]] && exit 0
[[ "$FILE_PATH" != *".ts" ]] && exit 0
[[ "$FILE_PATH" == *".d.ts" ]] && exit 0

cd "$CTXHARNESS_ROOT"

# Prefer rtk tsc if available
if command -v rtk &>/dev/null; then
  ERRORS=$(rtk tsc 2>&1 || true)
else
  ERRORS=$(pnpm exec tsc --noEmit 2>&1 || true)
fi

if [[ -n "$ERRORS" ]]; then
  echo "systemMessage: TypeScript errors detected:"$'\n'"$ERRORS"
fi

exit 0
