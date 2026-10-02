#!/usr/bin/env bash
# PreToolUse for the Stripe connector tools (any name form).
# Only the HYDLNK sandbox account may be touched, and never in live mode.
#   - block when tool_input.livemode is true
#   - block when tool_input.stripe_context is present and is not the sandbox account
# Calls without a stripe_context (account listing, docs search, API search) pass through,
# otherwise account discovery would be impossible.
set -u

SANDBOX_ACCOUNT="acct_1ULlVoPPBBbR7vbm"

LIVE_ACCOUNT="acct_1ULlViAMuc2pWDjB"   # HYDLNK live

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // "stripe tool"' 2>/dev/null)
LIVE=$(printf '%s' "$INPUT" | jq -r '(.tool_input.livemode // false) | tostring' 2>/dev/null)
CTX=$(printf '%s' "$INPUT" | jq -r '.tool_input.stripe_context // empty' 2>/dev/null)

# Time-limited opt-in for an interactive go-live session Gary approved in chat: the git-ignored
# file tmp/allow-live-stripe holds a Unix expiry time (at most an hour ahead). While it is valid,
# HYDLNK's LIVE account may be used too; other businesses' accounts are still refused. Unattended
# sessions never create this file.
ROOT=${CLAUDE_PROJECT_DIR:-$(pwd)}
OPT_IN="$ROOT/tmp/allow-live-stripe"
if [ -f "$OPT_IN" ]; then
  EXP=$(head -c 20 "$OPT_IN" | tr -dc '0-9')
  NOW=$(date +%s)
  if [ -n "$EXP" ] && [ "$EXP" -gt "$NOW" ] && [ "$EXP" -le $((NOW + 3600)) ] \
    && { [ -z "$CTX" ] || [ "$CTX" = "$LIVE_ACCOUNT" ] || [ "$CTX" = "$SANDBOX_ACCOUNT" ]; }; then
    exit 0
  fi
fi

if [ "$LIVE" = "true" ]; then
  echo "Blocked $TOOL: livemode is true. HYDLNK uses the Stripe sandbox only (account $SANDBOX_ACCOUNT, livemode false)." >&2
  exit 2
fi

if [ -n "$CTX" ] && [ "$CTX" != "$SANDBOX_ACCOUNT" ]; then
  echo "Blocked $TOOL: stripe_context '$CTX' is not the HYDLNK sandbox ($SANDBOX_ACCOUNT). Never touch HYDLNK live or other businesses' accounts." >&2
  exit 2
fi

exit 0
