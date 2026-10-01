#!/usr/bin/env bash
# SessionStart (every source): make plain `pnpm ...` work in Claude Code's Bash tool.
#
# The Bash tool's shell resolves Node from Gary's nvm default (20), where the global pnpm is not
# the corepack shim and fails on this repo. This hook resolves the repo's .nvmrc (Node 24),
# turns on corepack so `pnpm` is the pnpm 10 pinned in package.json, and appends the result to
# $CLAUDE_ENV_FILE, which Claude Code applies to every later Bash command in the session.
# Nothing here changes Gary's global nvm default.
#
# Silent on success except one status line (stdout of a SessionStart hook reaches Claude's
# context). Never blocks the session: always exits 0.
#
# nvm is not written for `set -u`, so strict mode is deliberately not enabled here.

cat >/dev/null 2>&1 || true # drain stdin

# Nothing to do outside a Claude Code session that supports CLAUDE_ENV_FILE.
[ -n "${CLAUDE_ENV_FILE:-}" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "pin-node: nvm not found at $NVM_DIR; Bash commands use whatever node is on PATH. pnpm needs Node 24."
  exit 0
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh" >/dev/null 2>&1
nvm use >/dev/null 2>&1

NODE_VERSION=$(node -v 2>/dev/null || true)
case "$NODE_VERSION" in
  v24.* | v2[5-9].* | v[3-9][0-9].*) ;;
  *)
    echo "pin-node: Node 24 is not active (got '${NODE_VERSION:-none}'). Run 'nvm install' in the repo, then restart the session. pnpm commands will fail until then."
    exit 0
    ;;
esac

NODE_BIN=$(dirname "$(command -v node)")

# Fresh machine: the Node 24 bin has no pnpm shim until corepack is enabled (init.sh does the
# same). Best effort.
command -v pnpm >/dev/null 2>&1 || corepack enable >/dev/null 2>&1 || true

# Prepend the Node 24 bin dir (not a snapshot of the whole PATH), so PATH changes made elsewhere
# are kept. $PATH is expanded when the file is sourced, hence the single quotes.
{
  # shellcheck disable=SC2016 # the literal "$PATH" must reach the env file unexpanded
  printf 'export PATH=%q:"$PATH"\n' "$NODE_BIN"
  # Unattended sessions cannot answer corepack's "download pnpm?" prompt.
  echo 'export COREPACK_ENABLE_DOWNLOAD_PROMPT=0'
} >>"$CLAUDE_ENV_FILE"

PNPM_VERSION=$(COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm -v 2>/dev/null || true)
echo "pin-node: Bash commands use Node ${NODE_VERSION#v} and pnpm ${PNPM_VERSION:-unavailable} (plain pnpm works, no nvm prefix needed)."
exit 0
