#!/usr/bin/env bash
# Quiet runner: `scripts/q.sh <command...>`, e.g. `scripts/q.sh pnpm verify` or
# `scripts/q.sh pnpm test tests/unit/m11-*`.
# The full output goes to tmp/logs/<label>.log and never reaches the caller. On success it prints
# one PASS line with the test counts; on failure only the lines that name failures (capped at
# Q_LINES, default 60) and the last 12 lines, plus the log path to grep for more. The exit code is
# the command's. Built so agents read failures, not thousands of passing lines.
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$ROOT/tmp/logs"
LABEL=$(printf '%s' "$*" | tr -cs 'A-Za-z0-9' '-' | cut -c1-60 | sed 's/-*$//')
LOG="$ROOT/tmp/logs/${LABEL:-run}.log"

START=$(date +%s)
NO_COLOR=1 FORCE_COLOR=0 "$@" >"$LOG" 2>&1
CODE=$?
SECS=$(($(date +%s) - START))

if [ "$CODE" -eq 0 ]; then
  # Vitest "Test Files / Tests", Playwright "N passed", pg_prove "Files=.. Tests=..".
  SUMMARY=$(grep -E '^ *(Test Files|Tests) |^ *[0-9]+ (passed|skipped|flaky)|^Files=|^Result:' "$LOG" |
    tr -s ' ' | tail -4 | paste -sd ';' -)
  if grep -qiE 'no test files found|no tests found' "$LOG"; then
    echo "EMPTY (${SECS}s) $*  matched no test files: check the path"
    exit 3
  fi
  echo "PASS (${SECS}s) $*${SUMMARY:+ | $SUMMARY}"
  exit 0
fi

echo "FAIL (exit $CODE, ${SECS}s) $*  full log: ${LOG#"$ROOT"/}"
grep -nE 'FAIL|✗|×|✘|AssertionError|Error:|error TS[0-9]+|^ +[0-9]+:[0-9]+ +error|^/.*\.(tsx?|mjs|js|sql)$|not ok|# Failed|Expected|Received|❯ .*:[0-9]+|^ +[0-9]+\) ' "$LOG" |
  grep -v node_modules | awk '!seen[$0]++' | head -n "${Q_LINES:-60}"
echo "--- last 12 lines"
tail -n 12 "$LOG"
exit "$CODE"
