#!/usr/bin/env bash
# Injects current branch, last commit, and uncommitted file count as context.
set -euo pipefail

CTXHARNESS_ROOT="$(git rev-parse --show-toplevel)"
cd "$CTXHARNESS_ROOT"

BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
LAST_COMMIT=$(git log -1 --oneline 2>/dev/null || echo "none")
DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

cat <<EOF
additionalContext: |
  Branch: $BRANCH
  Last commit: $LAST_COMMIT
  Uncommitted files: $DIRTY
EOF

exit 0
