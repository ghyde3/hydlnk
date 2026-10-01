#!/usr/bin/env bash
#
# HYDLNK session start. Safe to run every session, as often as you like.
#
#   1. pnpm install --frozen-lockfile, then playwright install chromium (no-op when present)
#   2. start local Supabase if it is not already running
#   3. write .env.local from `supabase status` (keys are never printed)
#   4. supabase db reset (migrations + seed.sql)
#   5. start the dev server if port 3000 is free
#   6. run the @smoke Playwright tests on both projects (phone + desktop)
#   7. print a one-screen status
#
# Exit status is non-zero when the smoke tests fail or setup cannot finish.
# If Docker Desktop's credential helper hangs (it does on some Macs), scripts/lib/docker-env.sh
# detects that in 5 seconds and works around it for this run; nothing to do by hand.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# nvm is not written for `set -u`, so load it before strict mode. CI uses actions/setup-node
# instead and has no nvm; that is fine as long as the Node version check below passes.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
  nvm use >/dev/null 2>&1 || true
fi

set -euo pipefail

# Docker credential-helper hang workaround (macOS only, a no-op on Linux/CI). Exports
# DOCKER_CONFIG and DOCKER_HOST for the supabase commands below when the probe fails.
# shellcheck source=lib/docker-env.sh
. "$ROOT/scripts/lib/docker-env.sh"

DEV_PORT=3000
DEV_URL="http://localhost:${DEV_PORT}"
ENV_FILE="${ENV_FILE:-$ROOT/.env.local}"
DEV_LOG="$ROOT/tmp/dev.log"
DEV_PID_FILE="$ROOT/tmp/dev.pid"
SMOKE_LOG="$ROOT/tmp/smoke.log"

say() { printf '[init] %s\n' "$*"; }
die() {
  printf '[init] ERROR: %s\n' "$*" >&2
  exit 1
}
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required but was not found on PATH. $2"; }

port_in_use() { lsof -nP -iTCP:"$DEV_PORT" -sTCP:LISTEN >/dev/null 2>&1; }

# Prints the value of NAME from the `supabase status -o env` text in $SB_ENV (values are quoted).
sb_value() {
  local want=$1 line
  while IFS= read -r line; do
    case $line in
      "$want="*)
        line=${line#"$want="}
        line=${line#\"}
        line=${line%\"}
        printf '%s' "$line"
        return 0
        ;;
    esac
  done <<<"$SB_ENV"
  return 1
}

# `supabase status` exits non-zero when optional services (imgproxy, pooler) are stopped, even
# though the stack is healthy, so judge by output instead of exit code. Stdout only: warnings and
# update notices go to stderr.
read_sb_env() { SB_ENV=$(supabase status -o env 2>/dev/null || true); }
sb_running() { [[ "$SB_ENV" == *API_URL=* ]]; }

ensure_node() {
  local major
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [ "$major" -ge 24 ] || die "Node 24 or newer is required (found ${major}). Run: nvm install && nvm use"
}

install_deps() {
  corepack enable >/dev/null 2>&1 || say "corepack enable failed; using the pnpm already on PATH"
  need pnpm "Install it with: corepack enable"
  say "installing dependencies"
  pnpm install --frozen-lockfile >"$ROOT/tmp/install.log" 2>&1 ||
    {
      tail -n 30 "$ROOT/tmp/install.log" >&2
      die "pnpm install failed (full log: tmp/install.log)"
    }
  # The browser binary is not part of `pnpm install`; without it the smoke step fails on a fresh
  # machine. A no-op (about a second) when this Playwright version's chromium is already cached.
  say "ensuring the Playwright chromium browser is installed"
  pnpm exec playwright install chromium >"$ROOT/tmp/playwright-install.log" 2>&1 ||
    {
      tail -n 30 "$ROOT/tmp/playwright-install.log" >&2
      die "playwright install chromium failed (full log: tmp/playwright-install.log)"
    }
}

start_supabase() {
  read_sb_env
  if sb_running; then
    say "local Supabase already running"
    return 0
  fi
  say "starting local Supabase (first run pulls images and can take a few minutes)"
  supabase start >"$ROOT/tmp/supabase-start.log" 2>&1 ||
    {
      tail -n 30 "$ROOT/tmp/supabase-start.log" >&2
      die "supabase start failed. Is Docker running? Log: tmp/supabase-start.log"
    }
  read_sb_env
  sb_running || die "supabase started but \`supabase status -o env\` returned nothing"
}

# Writes $ENV_FILE with the four managed variables. Any other KEY=value line already in the file
# (STRIPE_*, a Google client secret, ...) is carried over. Values are never printed.
write_env_local() {
  local api_url pub_key secret_key preserved tmp
  api_url=$(sb_value API_URL) || die "API_URL missing from \`supabase status -o env\`"
  pub_key=$(sb_value PUBLISHABLE_KEY) || die "PUBLISHABLE_KEY missing from \`supabase status -o env\`"
  secret_key=$(sb_value SECRET_KEY) || die "SECRET_KEY missing from \`supabase status -o env\`"
  [ -n "$api_url" ] && [ -n "$pub_key" ] && [ -n "$secret_key" ] || die "Supabase status returned an empty URL or key"

  preserved=""
  if [ -f "$ENV_FILE" ]; then
    preserved=$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" |
      grep -Ev '^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY|NEXT_PUBLIC_ROOT_DOMAIN)=' ||
      true)
  fi

  tmp=$(mktemp "${ENV_FILE}.XXXXXX")
  {
    echo "# Generated by scripts/init.sh from \`supabase status\` (local stack only). Git-ignored."
    echo "# The four variables below are rewritten on every run; any other lines are kept."
    echo "NEXT_PUBLIC_SUPABASE_URL=$api_url"
    echo "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$pub_key"
    echo "SUPABASE_SECRET_KEY=$secret_key"
    echo "NEXT_PUBLIC_ROOT_DOMAIN=localhost:${DEV_PORT}"
    if [ -n "$preserved" ]; then printf '%s\n' "$preserved"; fi
  } >"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
  say "wrote $(basename "$ENV_FILE") (Supabase URL and keys, root domain, preserved extras)"
}

reset_db() {
  say "resetting database (migrations + seed)"
  supabase db reset >"$ROOT/tmp/db-reset.log" 2>&1 ||
    {
      tail -n 30 "$ROOT/tmp/db-reset.log" >&2
      die "supabase db reset failed (full log: tmp/db-reset.log)"
    }
}

DEV_STARTED_BY_US=0
start_dev_server() {
  if port_in_use; then
    say "port ${DEV_PORT} already in use; assuming the dev server is running"
    return 0
  fi
  say "starting dev server (log: tmp/dev.log)"
  # Job control gives the background job its own process group, so the whole pnpm -> next tree
  # can be stopped with one `kill -- -PID`. stdin must not be the terminal: a background process
  # group that reads the tty is stopped (SIGTTIN) and startup would hang.
  set -m
  nohup pnpm dev >"$DEV_LOG" 2>&1 </dev/null &
  echo $! >"$DEV_PID_FILE"
  set +m
  DEV_STARTED_BY_US=1
  wait_for_dev_server
}

wait_for_dev_server() {
  local pid code i
  pid=$(cat "$DEV_PID_FILE")
  for ((i = 0; i < 120; i++)); do
    if ! kill -0 "$pid" 2>/dev/null; then
      tail -n 30 "$DEV_LOG" >&2
      die "dev server exited during startup (log: tmp/dev.log)"
    fi
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$DEV_URL/" 2>/dev/null || true)
    if [ -n "$code" ] && [ "$code" != "000" ]; then
      say "dev server answering at $DEV_URL (HTTP $code)"
      return 0
    fi
    sleep 1
  done
  tail -n 30 "$DEV_LOG" >&2
  die "dev server did not answer within 120s (log: tmp/dev.log)"
}

SMOKE_RC=0
run_smoke() {
  say "running smoke tests on phone + desktop"
  pnpm exec playwright test --grep @smoke >"$SMOKE_LOG" 2>&1 || SMOKE_RC=$?
}

print_status() {
  local commit smoke_summary dev_note features next
  commit=$(git log -1 --format='%h %s' 2>/dev/null || echo "no commits")
  dev_note="already running (not started by init.sh)"
  if [ "$DEV_STARTED_BY_US" = 1 ]; then
    dev_note="started by init.sh, pid $(cat "$DEV_PID_FILE"), log tmp/dev.log
               stop: kill -- -\$(cat tmp/dev.pid)"
  elif [ -f "$DEV_PID_FILE" ] && kill -0 "$(cat "$DEV_PID_FILE")" 2>/dev/null; then
    dev_note="started by an earlier init.sh run, pid $(cat "$DEV_PID_FILE"), log tmp/dev.log
               stop: kill -- -\$(cat tmp/dev.pid)"
  fi

  if [ "$SMOKE_RC" -eq 0 ]; then
    smoke_summary="PASS  ($(grep -E '^[[:space:]]+[0-9]+ (passed|skipped|failed)' "$SMOKE_LOG" | sed 's/^[[:space:]]*//' | paste -sd, - | sed 's/,/, /g'))"
  else
    smoke_summary="FAIL  (exit $SMOKE_RC, full log tmp/smoke.log)"
  fi

  echo
  echo "================ HYDLNK session status ================"
  echo "branch    $(git branch --show-current 2>/dev/null || echo '?') @ $commit"
  echo "supabase  API    $(sb_value API_URL || echo '?')"
  echo "          Studio $(sb_value STUDIO_URL || echo '?')"
  echo "          Mail   $(sb_value MAILPIT_URL || sb_value INBUCKET_URL || echo '?')"
  echo "dev       $DEV_URL   app: http://app.localhost:${DEV_PORT}   tenant: http://mara.localhost:${DEV_PORT}"
  echo "          $dev_note"
  echo "smoke     $smoke_summary"
  if [ "$SMOKE_RC" -ne 0 ]; then
    echo "          last lines of tmp/smoke.log:"
    tail -n 25 "$SMOKE_LOG" | sed 's/^/          /'
  fi
  features="$ROOT/docs/features.json"
  if [ -f "$features" ] && command -v jq >/dev/null 2>&1; then
    next=$(jq -r '(if type == "array" then . else (.features // []) end)
                  | map(select(.passes == false)) | .[0:3][]
                  | "  \(.id)  \(.title)"' "$features" 2>/dev/null || true)
    echo "next up   (first 3 features with passes:false)"
    if [ -n "$next" ]; then printf '%s\n' "$next" | sed 's/^/        /'; else echo "          none left, or docs/features.json could not be read"; fi
  else
    echo "next up   (docs/features.json not available yet)"
  fi
  echo "======================================================="
}

main() {
  need supabase "Install the Supabase CLI: https://supabase.com/docs/guides/local-development/cli/getting-started"
  need git ""
  need lsof ""
  need curl ""
  ensure_node
  mkdir -p "$ROOT/tmp"
  install_deps
  start_supabase
  write_env_local
  reset_db
  start_dev_server
  run_smoke
  print_status
  exit "$SMOKE_RC"
}

# Run main only when executed, so the functions above can be sourced for testing.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
