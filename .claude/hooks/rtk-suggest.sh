#!/usr/bin/env bash
# Suggests rtk equivalents when raw expensive commands are detected.
set -euo pipefail

CMD="${CLAUDE_TOOL_INPUT:-}"
[[ -z "$CMD" ]] && exit 0

suggest() {
  echo "systemMessage: RTK tip — use \`$1\` instead for ~$2% token savings." >&2
}

[[ "$CMD" =~ ^git[[:space:]]+status ]]        && suggest "rtk git status" 70
[[ "$CMD" =~ ^git[[:space:]]+log ]]           && suggest "rtk git log" 70
[[ "$CMD" =~ ^git[[:space:]]+diff ]]          && suggest "rtk git diff" 65
[[ "$CMD" =~ ^pnpm[[:space:]]+tsc ]]          && suggest "rtk tsc" 75
[[ "$CMD" =~ tsc[[:space:]]+--noEmit ]]       && suggest "rtk tsc" 75
[[ "$CMD" =~ vitest[[:space:]]+run ]]         && suggest "rtk vitest run" 99
[[ "$CMD" =~ pnpm[[:space:]]+test ]]          && suggest "rtk vitest run" 99
[[ "$CMD" =~ pnpm[[:space:]]+list ]]          && suggest "rtk pnpm list" 70

exit 0
