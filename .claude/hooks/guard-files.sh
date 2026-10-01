#!/usr/bin/env bash
# PreToolUse (Edit|Write): block edits to
#   - supabase/migrations/*.sql that git already tracks (write a new migration instead)
#   - secret env files: .env, .env.local, .env.*.local, supabase/.env (.env.example is fine)
# Block = exit 2 with the reason on stderr.
set -u

INPUT=$(cat)
ROOT=${CLAUDE_PROJECT_DIR:-$(pwd)}
cd "$ROOT" || exit 0
ROOT_REAL=$(pwd -P)

FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -n "$FILE" ] || exit 0

case "$FILE" in
  "$ROOT"/*) REL=${FILE#"$ROOT"/} ;;
  "$ROOT_REAL"/*) REL=${FILE#"$ROOT_REAL"/} ;;
  /*) REL=$FILE ;;
  *) REL=${FILE#./} ;;
esac
BASE=${REL##*/}

# --- secret env files -------------------------------------------------------
case "$BASE" in
  .env.example) ;; # explicitly allowed
  .env | .env.local | .env.*.local)
    echo "Blocked: $REL is a secret env file. Edit .env.example for names and defaults; the user manages real values." >&2
    exit 2
    ;;
esac
if [ "$REL" = "supabase/.env" ]; then
  echo "Blocked: supabase/.env holds secrets (for example the Google client secret). The user manages it." >&2
  exit 2
fi

# --- committed migrations ---------------------------------------------------
case "$REL" in
  supabase/migrations/*.sql)
    if git ls-files --error-unmatch -- "$REL" >/dev/null 2>&1; then
      echo "Blocked: $REL is already tracked by git. Never edit a committed migration: write a new one with 'supabase migration new <slug>' (see the db-change skill)." >&2
      exit 2
    fi
    ;;
esac

exit 0
