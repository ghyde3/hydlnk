#!/usr/bin/env bash
# Stop: if code changed since the last commit (src/ supabase/ tests/ scripts/), run
# typecheck + lint + unit tests and block finishing while they fail.
# Nothing changed (questions, plan-only turns) -> exit 0 immediately.
# After 3 consecutive blocks -> let Claude stop, with a note on stderr.
#
# Consecutive blocks are read from the hook input's consecutive_block_count. That field is not
# in the current hooks docs and the installed CLI (2.1.201) does not send it, so when it is
# absent this script counts its own blocks per session: it keeps a counter file and trusts it
# only while stop_hook_active is true (Claude is continuing because of a stop hook). Claude
# Code's own cap of 8 consecutive stop-hook continuations remains the final backstop.
set -u

INPUT=$(cat)
ROOT=${CLAUDE_PROJECT_DIR:-$(pwd)}
cd "$ROOT" || exit 0

jqr() { printf '%s' "$INPUT" | jq -r "$1" 2>/dev/null; }

FIELD=$(jqr '.consecutive_block_count // empty')
ACTIVE=$(jqr '.stop_hook_active // false')
SESSION=$(jqr '.session_id // "nosession"')
STATE_DIR=$(jqr '.scratchpad_dir // empty')
{ [ -n "$STATE_DIR" ] && [ -d "$STATE_DIR" ] && [ -w "$STATE_DIR" ]; } || STATE_DIR=${TMPDIR:-/tmp}
STATE="$STATE_DIR/hydlnk-stop-blocks-${SESSION//[^A-Za-z0-9_-]/_}"

# Tracked diffs vs HEAD (staged or not) and untracked files. Missing pathspecs are fine.
CHANGES=$(git status --porcelain -- src supabase tests scripts 2>/dev/null)
if [ -z "$CHANGES" ]; then
  rm -f "$STATE"
  exit 0
fi

case "$FIELD" in
  '' | *[!0-9]*)
    COUNT=0
    if [ "$ACTIVE" = "true" ] && [ -f "$STATE" ]; then
      COUNT=$(cat "$STATE" 2>/dev/null)
      case "$COUNT" in '' | *[!0-9]*) COUNT=0 ;; esac
    fi
    ;;
  *) COUNT=$FIELD ;;
esac

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
  nvm use >/dev/null 2>&1
fi

LOG=$(mktemp "${TMPDIR:-/tmp}/hydlnk-stop.XXXXXX") || exit 0
trap 'rm -f "$LOG"' EXIT

FAILED=""
for step in typecheck lint test; do
  echo "=== pnpm $step ===" >>"$LOG"
  if ! pnpm "$step" >>"$LOG" 2>&1; then
    FAILED=$step
    break
  fi
done

if [ -z "$FAILED" ]; then
  rm -f "$STATE"
  exit 0
fi

if [ "$COUNT" -ge 3 ]; then
  rm -f "$STATE"
  {
    echo "stop-checks: 'pnpm $FAILED' is still failing after $COUNT blocked stops. Allowing stop."
    echo "Leave the failure in PROGRESS.md (Known issues) so the next session starts there."
  } >&2
  exit 0
fi

echo $((COUNT + 1)) >"$STATE" 2>/dev/null
{
  echo "Blocked: 'pnpm $FAILED' failed and files under src/ supabase/ tests/ scripts/ have uncommitted changes. Fix this before finishing (last 40 lines):"
  tail -n 40 "$LOG"
} >&2
exit 2
