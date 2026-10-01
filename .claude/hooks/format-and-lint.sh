#!/usr/bin/env bash
# PostToolUse (Edit|Write): format and lint only the file that was just touched.
# prettier --write for ts/tsx/js/mjs/cjs/json/css, eslint --fix for ts/tsx/js/mjs.
# Remaining eslint errors (or an unparseable file) -> exit 2 with a short summary on
# stderr, which Claude sees. Everything else -> exit 0.
set -u

INPUT=$(cat)
ROOT=${CLAUDE_PROJECT_DIR:-$(pwd)}
cd "$ROOT" || exit 0
ROOT_REAL=$(pwd -P)

FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -n "$FILE" ] || exit 0
[ -f "$FILE" ] || exit 0

# Only files inside the project.
case "$FILE" in
  "$ROOT"/*) REL=${FILE#"$ROOT"/} ;;
  "$ROOT_REAL"/*) REL=${FILE#"$ROOT_REAL"/} ;;
  /*) exit 0 ;;
  *) REL=${FILE#./} ;;
esac

# Never reformat source-of-truth docs, mockups, committed-history SQL, markdown, or machine-owned dirs.
case "$REL" in
  docs/* | design/* | supabase/migrations/* | node_modules/* | .next/* | tmp/* | *.md | *.mdx) exit 0 ;;
  src/lib/supabase/database.types.ts) exit 0 ;;
esac

EXT=${REL##*.}
RUN_PRETTIER=0
RUN_ESLINT=0
case "$EXT" in
  ts | tsx | js | mjs | cjs | mts | cts) RUN_PRETTIER=1; RUN_ESLINT=1 ;;
  json | css) RUN_PRETTIER=1 ;;
esac
[ "$RUN_PRETTIER" = 1 ] || exit 0

# Node 24 from .nvmrc (the default node on this machine is older).
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
  nvm use >/dev/null 2>&1
fi

# Fresh checkout without node_modules: nothing to run, do not nag.
[ -d node_modules ] || exit 0

run() {
  local bin=$1
  shift
  if [ -x "node_modules/.bin/$bin" ]; then
    "node_modules/.bin/$bin" "$@"
  else
    pnpm exec "$bin" "$@"
  fi
}

OUT=$(mktemp "${TMPDIR:-/tmp}/hydlnk-fmt.XXXXXX") || exit 0
trap 'rm -f "$OUT"' EXIT

if ! run prettier --write --ignore-unknown "$REL" >"$OUT" 2>&1; then
  {
    echo "prettier could not format $REL (syntax error?). Fix it:"
    head -15 "$OUT"
  } >&2
  exit 2
fi

if [ "$RUN_ESLINT" = 1 ]; then
  if ! run eslint --fix --no-warn-ignored "$REL" >"$OUT" 2>&1; then
    {
      echo "eslint errors remain in $REL after --fix. Fix them:"
      head -25 "$OUT"
    } >&2
    exit 2
  fi
fi

exit 0
