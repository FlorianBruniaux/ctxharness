#!/usr/bin/env bash
# Detects hardcoded secrets and dangerous patterns before writing files.
set -euo pipefail

TOOL_NAME="${CLAUDE_TOOL_NAME:-}"
CONTENT="${CLAUDE_TOOL_INPUT:-}"

[[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" ]] && exit 0
[[ -z "$CONTENT" ]] && exit 0

flag() {
  echo "BLOCK: Security gate — $1" >&2
  exit 2
}

# Hardcoded secrets
[[ "$CONTENT" =~ (sk-[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}) ]] \
  && flag "potential API key or AWS access key in content"

[[ "$CONTENT" =~ password[[:space:]]*=[[:space:]]*['\"][^'\"]{6,} ]] \
  && flag "hardcoded password assignment"

# eval() with dynamic input
[[ "$CONTENT" =~ eval\(.*\+.*\) ]] \
  && flag "eval() with string concatenation"

# Path traversal
[[ "$CONTENT" =~ \.\./\.\./\.\. ]] \
  && flag "deep path traversal pattern (../../..)"

exit 0