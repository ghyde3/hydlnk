#!/usr/bin/env bash
#
# Regenerates src/lib/supabase/database.types.ts from the local Supabase database (run `pnpm
# db:reset` first if you just added a migration). Sources scripts/lib/docker-env.sh so the Docker
# Desktop credential-helper hang cannot stall the image lookup. The output goes to a temp file and
# replaces the real one only when the CLI succeeds, so a failed run never leaves an empty file.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=lib/docker-env.sh
. "$ROOT/scripts/lib/docker-env.sh"

OUT="src/lib/supabase/database.types.ts"
TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/hydlnk-db-types.XXXXXX")"
trap 'rm -f "$TMP_FILE"' EXIT

supabase gen types typescript --local --schema public >"$TMP_FILE"
[ -s "$TMP_FILE" ] || {
  echo "[db-types] supabase gen types produced no output; $OUT left unchanged" >&2
  exit 1
}
cat "$TMP_FILE" >"$OUT"
echo "[db-types] wrote $OUT"
