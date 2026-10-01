#!/usr/bin/env bash
# SessionStart (startup|resume|compact): stdout is added to Claude's context.
# Prints the top of PROGRESS.md, the current branch and the next 3 failing features.
set -u

cat >/dev/null 2>&1 || true # drain stdin
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0

BRANCH=$(git branch --show-current 2>/dev/null)
if [ -z "$BRANCH" ]; then
  if git rev-parse --git-dir >/dev/null 2>&1; then BRANCH="(detached HEAD)"; else BRANCH="(not a git repo)"; fi
fi
echo "HYDLNK session start. Branch: $BRANCH"
echo

if [ -f PROGRESS.md ]; then
  echo "--- PROGRESS.md (top 30 lines) ---"
  head -n 30 PROGRESS.md
else
  echo "PROGRESS.md: not found."
fi
echo

if [ -f docs/features.json ] && command -v jq >/dev/null 2>&1; then
  FILTER='if type=="array" then . else (.features // []) end'
  TOTAL=$(jq -r "$FILTER | length" docs/features.json 2>/dev/null)
  if [ -n "$TOTAL" ]; then
    DONE=$(jq -r "$FILTER | map(select(.passes==true)) | length" docs/features.json 2>/dev/null)
    echo "--- docs/features.json: $DONE of $TOTAL pass. Next 3 failing ---"
    jq -r "$FILTER | map(select(.passes==false)) | .[0:3][] | \"- \(.id): \(.title)\"" docs/features.json 2>/dev/null
  else
    echo "docs/features.json: could not parse."
  fi
else
  echo "docs/features.json: not found."
fi
exit 0
