#!/usr/bin/env bash
# shellcheck shell=bash
#
# Source this file (do not execute it) before any command that makes the Supabase CLI resolve a
# Docker image: `supabase start`, `supabase gen types`, `supabase db reset`.
#
# Why: on some Macs `docker-credential-desktop get` (Docker Desktop's credential helper) never
# returns, and every image pull or lookup stalls behind it. This file probes the helper with a
# 5-second limit. When it hangs or fails, it points DOCKER_CONFIG at an empty config
# (tmp/docker-config, so no credential helper is consulted) and DOCKER_HOST at Docker Desktop's
# user socket, then prints one warning line. ~/.docker is never modified.
#
# No-op (no probe, no output, nothing exported) when: CI is set, the OS is not macOS,
# DOCKER_CONFIG is already set, the Docker config names no credential helper, or the helper is not
# installed. That covers Linux, GitHub Actions and any machine whose Docker setup already works.
#
# Public pieces: hydlnk_docker_env (runs automatically when sourced) and DOCKER_ENV_ADJUSTED=1 when
# it changed the environment.

# The probe is a fork + SIGKILL, not `alarm; exec`: the helper is a Go program, and Go ignores
# SIGALRM, so an alarm set before exec never stops it. The command runs in its own process group so
# that anything it spawned dies with it. $1 = seconds, rest = command (stdin passes through to the
# command). Exits 142 on timeout, 127 when the command cannot be run.
_hydlnk_run_with_timeout() {
  perl -e '
    my $secs = shift @ARGV;
    my $pid = fork();
    defined $pid or exit 127;
    if ($pid == 0) { setpgrp(0, 0); exec { $ARGV[0] } @ARGV; exit 127; }
    $SIG{ALRM} = sub { kill "KILL", -$pid; kill "KILL", $pid; waitpid($pid, 0); exit 142; };
    alarm $secs;
    waitpid($pid, 0);
    exit($? & 127 ? 128 + ($? & 127) : $? >> 8);
  ' "$@"
}

hydlnk_docker_env() {
  DOCKER_ENV_ADJUSTED=0
  [ -z "${CI:-}" ] || return 0
  [ "$(uname -s)" = "Darwin" ] || return 0
  [ -z "${DOCKER_CONFIG:-}" ] || return 0
  command -v perl >/dev/null 2>&1 || return 0

  local config_file store helper out rc
  config_file="${HOME}/.docker/config.json"
  [ -f "$config_file" ] || return 0
  store=$(sed -n 's/.*"credsStore"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$config_file" | head -n 1)
  [ -n "$store" ] || return 0
  helper="docker-credential-${store}"
  command -v "$helper" >/dev/null 2>&1 || return 0

  # `get` reads a registry URL on stdin. The Supabase images come from public.ecr.aws. A helper
  # that answers "credentials not found" is healthy (public images need no credentials).
  out=$(mktemp "${TMPDIR:-/tmp}/hydlnk-docker-probe.XXXXXX")
  rc=0
  printf '%s' "https://public.ecr.aws" | _hydlnk_run_with_timeout 5 "$helper" get >"$out" 2>&1 || rc=$?
  if [ "$rc" -eq 0 ] || grep -qi 'credentials not found' "$out"; then
    rm -f "$out"
    return 0
  fi
  rm -f "$out"

  # Resolve the repo root from this file (scripts/lib/docker-env.sh) so the config dir is stable.
  local here root fallback
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  root="$(cd "$here/../.." && pwd)"
  fallback="$root/tmp/docker-config"
  mkdir -p "$fallback"
  [ -f "$fallback/config.json" ] || printf '{}\n' >"$fallback/config.json"
  export DOCKER_CONFIG="$fallback"
  if [ -z "${DOCKER_HOST:-}" ] && [ -S "${HOME}/.docker/run/docker.sock" ]; then
    export DOCKER_HOST="unix://${HOME}/.docker/run/docker.sock"
  fi
  DOCKER_ENV_ADJUSTED=1
  if [ "$rc" -eq 142 ]; then
    echo "[docker-env] ${helper} did not answer within 5s; using an empty Docker config (tmp/docker-config). Restart Docker Desktop to fix it for good." >&2
  else
    echo "[docker-env] ${helper} failed (exit ${rc}); using an empty Docker config (tmp/docker-config). Restart Docker Desktop to fix it for good." >&2
  fi
}

hydlnk_docker_env
