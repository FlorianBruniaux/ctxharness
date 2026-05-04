#!/usr/bin/env bash
# Blocks genuinely destructive operations before they run.
set -euo pipefail

TOOL_NAME="${CLAUDE_TOOL_NAME:-}"
TOOL_INPUT="${CLAUDE_TOOL_INPUT:-}"

block() {
  echo "BLOCK: $1" >&2
  exit 2
}

# ── Bash commands ──────────────────────────────────────────────────────────────
if [[ "$TOOL_NAME" == "Bash" ]]; then
  CMD="$TOOL_INPUT"

  # Filesystem wipeouts
  [[ "$CMD" =~ rm[[:space:]]+-rf[[:space:]]+/ ]]       && block "rm -rf / detected"
  [[ "$CMD" =~ rm[[:space:]]+-rf[[:space:]]+\. ]]      && block "rm -rf . (project wipe)"

  # Force-push main
  [[ "$CMD" =~ git[[:space:]]+push.*--force.*main ]]   && block "force-push to main blocked"
  [[ "$CMD" =~ git[[:space:]]+push.*-f.*main ]]        && block "force-push to main blocked"

  # Publishing without explicit confirmation guard
  [[ "$CMD" =~ pnpm.*publish.*--no-git-checks ]] && [[ ! "$CMD" =~ "#confirmed" ]] \
    && block "pnpm publish --no-git-checks: add '#confirmed' comment to proceed"
fi

# ── Write / Edit ───────────────────────────────────────────────────────────────
if [[ "$TOOL_NAME" == "Write" || "$TOOL_NAME" == "Edit" ]]; then
  FILE_PATH="$TOOL_INPUT"
  CTXHARNESS_ROOT="/Users/florianbruniaux/Sites/perso/ctxharness"

  # Block edits outside project dir
  if [[ "$FILE_PATH" != "$CTXHARNESS_ROOT"* ]]; then
    block "edit outside project root: $FILE_PATH"
  fi

  # Block sensitive files
  [[ "$FILE_PATH" =~ \.env($|\.) ]]           && block "writing .env file"
  [[ "$FILE_PATH" =~ \.(pem|key|cert|p12)$ ]] && block "writing credential file"
  [[ "$FILE_PATH" =~ node_modules/ ]]         && block "writing into node_modules"
fi

exit 0
