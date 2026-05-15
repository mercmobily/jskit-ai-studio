#!/usr/bin/env bash
set -euo pipefail

# Development-only postinstall hook.
# Normal installs no-op. Set JSKIT_DEVLINKS or an ignored .jskit/config
# devel root to opt into local JSKIT package links, for example:
#   JSKIT_DEVLINKS=/path/to/jskit-ai npm install
#   JSKIT_DEVLINKS=1 JSKIT_AI_ROOT=/path/to/jskit-ai npm install
#   printf '%s\n' /path/to/jskit-ai > .jskit/config/devel_jskit_ai_root

SCRIPT_NAME="devel-link-local-packages-postinstall"

log() {
  printf '[%s] %s\n' "$SCRIPT_NAME" "$*" >&2
}

fail() {
  printf '[%s] ERROR: %s\n' "$SCRIPT_NAME" "$*" >&2
  exit 1
}

is_disabled_value() {
  case "${1-}" in
  "" | "0" | "false" | "False" | "FALSE" | "no" | "No" | "NO" | "off" | "Off" | "OFF")
    return 0
    ;;
  esac
  return 1
}

is_auto_value() {
  case "${1-}" in
    "1" | "true" | "True" | "TRUE" | "yes" | "Yes" | "YES" | "on" | "On" | "ON" | "auto" | "Auto" | "AUTO")
      return 0
      ;;
  esac
  return 1
}

read_config_root() {
  local base="$1"
  local candidate
  for candidate in \
    "$base/.jskit/config/devel_jskit_ai_root" \
    "$base/.jskit/config/devel_sibling_roots/jskit-ai"
  do
    if [ -f "$candidate" ]; then
      sed -n '1p' "$candidate"
      return 0
    fi
  done
  return 1
}

write_config_root() {
  local base="$1"
  local root="$2"
  if [ ! -d "$base/.jskit" ]; then
    return
  fi
  mkdir -p "$base/.jskit/config"
  printf '%s\n' "$root" > "$base/.jskit/config/devel_jskit_ai_root"
}

infer_session_context() {
  JSKIT_WORKTREE_ROOT="$(pwd -P)"
  if [ "$(basename "$JSKIT_WORKTREE_ROOT")" != "worktree" ]; then
    return 1
  fi

  JSKIT_SESSION_ROOT="$(dirname "$JSKIT_WORKTREE_ROOT")"
  local active_root
  active_root="$(dirname "$JSKIT_SESSION_ROOT")"
  if [ "$(basename "$active_root")" != "active" ]; then
    return 1
  fi

  local sessions_root
  sessions_root="$(dirname "$active_root")"
  if [ "$(basename "$sessions_root")" != "sessions" ]; then
    return 1
  fi

  local jskit_root
  jskit_root="$(dirname "$sessions_root")"
  if [ "$(basename "$jskit_root")" != ".jskit" ]; then
    return 1
  fi

  JSKIT_SESSION_ID="$(basename "$JSKIT_SESSION_ROOT")"
  JSKIT_TARGET_ROOT="$(dirname "$jskit_root")"
  export JSKIT_SESSION_ID JSKIT_SESSION_ROOT JSKIT_TARGET_ROOT JSKIT_WORKTREE_ROOT
  return 0
}

repo_root=""
repo_root_source=""
devlinks_value="${JSKIT_DEVLINKS-}"

if [ -n "$devlinks_value" ] && is_disabled_value "$devlinks_value"; then
  log "JSKIT_DEVLINKS is disabled; skipping local JSKIT package links."
  exit 0
fi

if [ -n "$devlinks_value" ]; then
  if is_auto_value "$devlinks_value"; then
    repo_root="${JSKIT_AI_ROOT-}"
  else
    repo_root="$devlinks_value"
  fi
  repo_root_source="env"
  if [ -z "$repo_root" ]; then
    fail "JSKIT_DEVLINKS is enabled, but no repo root was provided. Set JSKIT_DEVLINKS=/path/to/jskit-ai or JSKIT_AI_ROOT=/path/to/jskit-ai."
  fi
fi

cwd="$(pwd -P)"
session_context=0
if infer_session_context; then
  session_context=1
fi

if [ -z "$repo_root" ]; then
  repo_root="$(read_config_root "$cwd" || true)"
  if [ -n "$repo_root" ]; then
    repo_root_source="worktree-config"
  fi
fi

if [ -z "$repo_root" ] && [ "$session_context" -eq 1 ]; then
  repo_root="$(read_config_root "$JSKIT_TARGET_ROOT" || true)"
  if [ -n "$repo_root" ]; then
    repo_root_source="target-config"
  fi
fi

if [ -z "$repo_root" ]; then
  log "No development JSKIT repo root configured; skipping local JSKIT package links."
  exit 0
fi

if ! git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [ "$session_context" -eq 1 ] && [ "$repo_root_source" != "env" ]; then
    log "Configured JSKIT repo root is not visible in this install environment; skipping local links here."
    log "The session provisioning hook can clone and link it from the host after dependency adoption."
    exit 0
  fi
  fail "JSKIT_DEVLINKS repo root is not a git work tree: $repo_root"
fi

repo_root="$(cd "$repo_root" && pwd -P)"

if [ "$session_context" -eq 1 ] && [ -f "$JSKIT_WORKTREE_ROOT/scripts/devel-provision-jskit-ai-studio-session.sh" ]; then
  log "Provisioning JSKIT development sibling repos for this session."
  JSKIT_DEVLINKS="$repo_root" \
  JSKIT_AI_ROOT="$repo_root" \
    bash "$JSKIT_WORKTREE_ROOT/scripts/devel-provision-jskit-ai-studio-session.sh"
  exit 0
fi

write_config_root "$cwd" "$repo_root"
log "Linking local JSKIT packages from $repo_root."
npx --no-install jskit app link-local-packages --repo-root "$repo_root"
