#!/usr/bin/env bash
#
# Cloud session bootstrap (Claude Code on the web, or any bare Linux container). Safe to rerun.
# Gets the container to the point where `./scripts/init.sh` works:
#
#   1. Node from .nvmrc into /opt/node<major>, linked first on PATH (~/.local/bin)
#   2. the Supabase CLI pinned in .github/workflows/ci.yml (both binaries: supabase, supabase-go)
#   3. the Docker daemon, if it is installed but not running
#   4. Supabase's images from ghcr.io, retagged to the public.ecr.aws names the CLI asks for
#      (ECR's anonymous pull limit is usually spent on shared cloud IPs)
#
# Needs the environment's network policy to allow ghcr.io and pkg-containers.githubusercontent.com
# (the "hydlnk" cloud environment does). Not for Gary's Mac: there nvm and Docker Desktop do this.
# Never touches production. Afterwards run: ./scripts/init.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
BIN="$HOME/.local/bin"
mkdir -p "$BIN" "$ROOT/tmp"
say() { printf '[cloud-init] %s\n' "$*"; }
die() {
  printf '[cloud-init] ERROR: %s\n' "$*" >&2
  exit 1
}

# `scripts/cloud-init.sh image <name:tag>`: fetch one more Supabase image the same way, for a
# command that fails on a public.ecr.aws pull (for example `pnpm db:types` wants its own
# postgres-meta tag; the failing command's --debug output names it).
if [ "${1:-}" = "image" ]; then
  [ -n "${2:-}" ] || die "usage: scripts/cloud-init.sh image <name:tag>, e.g. postgres-meta:v0.96.1"
  docker pull -q "ghcr.io/supabase/$2" >/dev/null || die "could not pull ghcr.io/supabase/$2"
  docker tag "ghcr.io/supabase/$2" "public.ecr.aws/supabase/$2"
  say "tagged public.ecr.aws/supabase/$2"
  exit 0
fi

[ "$(uname -s)" = "Linux" ] || die "Linux only. On macOS use nvm and Docker Desktop, then ./scripts/init.sh."
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) die "$BIN is not on PATH; add it before the system node and rerun." ;;
esac

# --- 1. Node ------------------------------------------------------------------------------
WANT=$(tr -d 'v \n' <.nvmrc)
WANT_MAJOR=${WANT%%.*}
HAVE=$(node -v 2>/dev/null || true)
if [ "${HAVE#v}" = "${HAVE#v"$WANT_MAJOR".}" ]; then
  DIR="/opt/node$WANT_MAJOR"
  if [ ! -x "$DIR/bin/node" ]; then
    say "installing Node $WANT_MAJOR into $DIR"
    SUMS=$(curl -fsSL "https://nodejs.org/dist/latest-v$WANT_MAJOR.x/SHASUMS256.txt")
    LINE=$(printf '%s\n' "$SUMS" | grep 'linux-x64.tar.xz$')
    FILE=${LINE##* }
    TMP=$(mktemp -d)
    curl -fsSL -o "$TMP/$FILE" "https://nodejs.org/dist/latest-v$WANT_MAJOR.x/$FILE"
    (cd "$TMP" && printf '%s\n' "$LINE" | sha256sum -c - >/dev/null) || die "Node checksum mismatch"
    mkdir -p "$DIR" && tar -xJf "$TMP/$FILE" -C "$DIR" --strip-components=1
    rm -rf "$TMP"
  fi
  for b in node npm npx corepack; do ln -sf "$DIR/bin/$b" "$BIN/$b"; done
  hash -r
fi
case "$(node -v)" in
  "v$WANT_MAJOR."*) say "node $(node -v)" ;;
  *) die "node is $(node -v), wanted $WANT_MAJOR. Is $BIN ahead of the system node on PATH?" ;;
esac

# --- 2. Supabase CLI ------------------------------------------------------------------------
CLI_VERSION=$(sed -n '/supabase\/setup-cli/,/version:/s/.*version: *//p' .github/workflows/ci.yml | head -1)
[ -n "$CLI_VERSION" ] || die "could not read the Supabase CLI version from .github/workflows/ci.yml"
if [ ! -x "$BIN/supabase-go" ] || ! (cd / && supabase --version 2>/dev/null | grep -q "$CLI_VERSION"); then
  say "installing Supabase CLI $CLI_VERSION"
  TMP=$(mktemp -d)
  curl -fsSL -o "$TMP/sb.tgz" \
    "https://github.com/supabase/cli/releases/download/v$CLI_VERSION/supabase_linux_amd64.tar.gz"
  tar -xzf "$TMP/sb.tgz" -C "$TMP"
  cp "$TMP/supabase" "$TMP/supabase-go" "$BIN/"
  rm -rf "$TMP"
fi
say "supabase $(cd / && supabase --version)"
# The CLI's telemetry cannot reach its host from a locked-down container; the shutdown timeout
# then turns a passing `supabase test db` into exit code 1.
(cd / && supabase telemetry disable >/dev/null 2>&1) || true

# --- 3. Docker daemon -----------------------------------------------------------------------
command -v docker >/dev/null || die "docker is not installed in this container"
if ! docker info >/dev/null 2>&1; then
  say "starting dockerd"
  (nohup dockerd >"$ROOT/tmp/dockerd.log" 2>&1 &)
  for _ in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
  docker info >/dev/null 2>&1 || die "dockerd did not start; see tmp/dockerd.log"
fi

# --- 4. Supabase images from ghcr.io --------------------------------------------------------
# One dry start names every image this CLI version wants; pull each from ghcr.io and retag.
SERVICES_OFF=studio,imgproxy,vector,analytics,edge-runtime,realtime # same list as CI
if ! supabase status >/dev/null 2>&1; then
  LOG="$ROOT/tmp/supabase-start.log"
  if ! timeout 120 supabase start -x "$SERVICES_OFF" >"$LOG" 2>&1; then
    pkill -f 'supabase(-go)? start' 2>/dev/null || true
    IMAGES=$(grep -oE 'public\.ecr\.aws/supabase/[a-z0-9._/-]+:[A-Za-z0-9._-]+' "$LOG" | sort -u)
    [ -n "$IMAGES" ] || die "supabase start failed for another reason; see tmp/supabase-start.log"
    for ecr in $IMAGES; do
      name=${ecr#public.ecr.aws/supabase/}
      case " $(printf '%s' "$SERVICES_OFF" | tr ',' ' ') logflare " in *" ${name%%:*} "*) continue ;; esac
      docker image inspect "$ecr" >/dev/null 2>&1 && continue
      say "pulling ghcr.io/supabase/$name"
      docker pull -q "ghcr.io/supabase/$name" >/dev/null ||
        die "could not pull ghcr.io/supabase/$name (is ghcr.io allowed by the environment's network policy?)"
      docker tag "ghcr.io/supabase/$name" "$ecr"
    done
    supabase stop >/dev/null 2>&1 || true
  fi
fi

say "ready. Next: ./scripts/init.sh   (or: scripts/q.sh scripts/init.sh)"
