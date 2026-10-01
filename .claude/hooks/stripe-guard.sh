#!/usr/bin/env bash
# PreToolUse for the Stripe connector tools (any name form).
# Only the HYDLNK sandbox account may be touched, and never in live mode.
#   - block when tool_input.livemode is true
#   - block when tool_input.stripe_context is present and is not the sandbox account
# Calls without a stripe_context (account listing, docs search, API search) pass through,
# otherwise account discovery would be impossible.
set -u

SANDBOX_ACCOUNT="acct_1ULlVoPPBBbR7vbm"

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // "stripe tool"' 2>/dev/null)
LIVE=$(printf '%s' "$INPUT" | jq -r '(.tool_input.livemode // false) | tostring' 2>/dev/null)
CTX=$(printf '%s' "$INPUT" | jq -r '.tool_input.stripe_context // empty' 2>/dev/null)

if [ "$LIVE" = "true" ]; then
  echo "Blocked $TOOL: livemode is true. HYDLNK uses the Stripe sandbox only (account $SANDBOX_ACCOUNT, livemode false)." >&2
  exit 2
fi

if [ -n "$CTX" ] && [ "$CTX" != "$SANDBOX_ACCOUNT" ]; then
  echo "Blocked $TOOL: stripe_context '$CTX' is not the HYDLNK sandbox ($SANDBOX_ACCOUNT). Never touch HYDLNK live or other businesses' accounts." >&2
  exit 2
fi

exit 0
