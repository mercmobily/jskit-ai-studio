#!/usr/bin/env bash
set -euo pipefail

# Development-only JSKIT adapter session provisioning for dogfooding this app.
# The AI Studio session runtime invokes this because package.json opts in with
# jskit:provision-session. Generic AI Studio behavior must not depend on it.
#
# Optional sibling repo config:
#   JSKIT_AI_ROOT=/absolute/path/to/jskit-ai
#   JSKIT_DEVLINKS=/absolute/path/to/jskit-ai
#   JSKIT_SIBLING_REPOS=jskit-ai
#   .jskit/config/devel_sibling_repos
#   .jskit/config/devel_sibling_roots/<repo-name>
#
# Sibling changes are guarded later by this directory's finalization hook.

SCRIPT_NAME="jskit-adapter-provision-session"

log() {
  printf '[%s] %s\n' "$SCRIPT_NAME" "$*" >&2
}

fail() {
  printf '[%s] ERROR: %s\n' "$SCRIPT_NAME" "$*" >&2
  exit 1
}

required_env() {
  local name="$1"
  local value="${!name-}"
  if [ -z "$value" ]; then
    fail "$name is required."
  fi
}

required_env JSKIT_SESSION_ID
required_env JSKIT_SESSION_ROOT
required_env JSKIT_TARGET_ROOT
required_env JSKIT_WORKTREE_ROOT

TARGET_CONFIG_DIR="$JSKIT_TARGET_ROOT/.jskit/config"
WORKTREE_CONFIG_DIR="$JSKIT_WORKTREE_ROOT/.jskit/config"
SIBLING_ROOT="$JSKIT_SESSION_ROOT/sibling-repos"
SIBLING_MANIFEST="$SIBLING_ROOT/manifest.tsv"
LINK_LOCAL_COMPANION_REPOS=("json-rest-schema" "json-rest-stores")

copy_target_config() {
  if [ ! -d "$TARGET_CONFIG_DIR" ]; then
    log "No target .jskit/config directory to copy."
    return
  fi

  mkdir -p "$WORKTREE_CONFIG_DIR"
  cp -a "$TARGET_CONFIG_DIR/." "$WORKTREE_CONFIG_DIR/"
  log "Copied target .jskit/config into the session worktree."
}

repo_env_prefix() {
  printf '%s' "$1" | tr '[:lower:]' '[:upper:]' | sed 's/[^A-Z0-9]/_/g'
}

devlinks_repo_root() {
  case "${JSKIT_DEVLINKS-}" in
    "" | "0" | "false" | "False" | "FALSE" | "no" | "No" | "NO" | "off" | "Off" | "OFF")
      return 1
      ;;
    "1" | "true" | "True" | "TRUE" | "yes" | "Yes" | "YES" | "on" | "On" | "ON" | "auto" | "Auto" | "AUTO")
      if [ -n "${JSKIT_AI_ROOT-}" ]; then
        printf '%s\n' "$JSKIT_AI_ROOT"
        return 0
      fi
      return 1
      ;;
    *)
      printf '%s\n' "$JSKIT_DEVLINKS"
      return 0
      ;;
  esac
}

configured_siblings() {
  local raw="${JSKIT_SIBLING_REPOS-}"
  if [ -z "$raw" ] && [ -f "$TARGET_CONFIG_DIR/devel_sibling_repos" ]; then
    raw="$(cat "$TARGET_CONFIG_DIR/devel_sibling_repos")"
  fi
  local devlinks_root
  devlinks_root="$(devlinks_repo_root || true)"
  if [ -z "$raw" ] && { [ -n "${JSKIT_AI_ROOT-}" ] || [ -n "$devlinks_root" ]; }; then
    raw="jskit-ai"
  fi

  printf '%s' "$raw" |
    sed 's/#.*$//g' |
    tr ',\n\r\t' '     ' |
    tr ' ' '\n' |
    sed '/^$/d' |
    awk '!seen[$0]++'
}

sibling_source_for() {
  local name="$1"
  local env_name
  env_name="$(repo_env_prefix "$name")_ROOT"
  local env_value="${!env_name-}"
  if [ -n "$env_value" ]; then
    printf '%s\n' "$env_value"
    return
  fi

  local configured_root="$TARGET_CONFIG_DIR/devel_sibling_roots/$name"
  if [ -f "$configured_root" ]; then
    sed -n '1p' "$configured_root"
    return
  fi

  if [ "$name" = "jskit-ai" ] && [ -f "$TARGET_CONFIG_DIR/devel_jskit_ai_root" ]; then
    sed -n '1p' "$TARGET_CONFIG_DIR/devel_jskit_ai_root"
    return
  fi

  if [ "$name" = "jskit-ai" ]; then
    local devlinks_root
    devlinks_root="$(devlinks_repo_root || true)"
    if [ -n "$devlinks_root" ]; then
      printf '%s\n' "$devlinks_root"
      return
    fi
  fi

  return 1
}

declares_package() {
  local package_name="$1"
  node -e '
const fs = require("node:fs");
const packageJsonPath = process.argv[1];
const packageName = process.argv[2];
const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
process.exit(sections.some((section) => Object.prototype.hasOwnProperty.call(packageJson[section] || {}, packageName)) ? 0 : 1);
' "$JSKIT_WORKTREE_ROOT/package.json" "$package_name"
}

manifest_includes_sibling() {
  local name="$1"
  [ -f "$SIBLING_MANIFEST.tmp" ] || return 1
  awk -F '\t' -v name="$name" '$1 == name { found = 1 } END { exit found ? 0 : 1 }' "$SIBLING_MANIFEST.tmp"
}

companion_source_for() {
  local name="$1"
  local jskit_source="$2"
  local configured_source
  configured_source="$(sibling_source_for "$name" || true)"
  if [ -n "$configured_source" ]; then
    printf '%s\n' "$configured_source"
    return 0
  fi

  if [ -n "$jskit_source" ]; then
    local adjacent_source
    adjacent_source="$(dirname "$jskit_source")/$name"
    if git -C "$adjacent_source" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      printf '%s\n' "$adjacent_source"
      return 0
    fi
  fi

  return 1
}

ensure_link_local_companions() {
  local jskit_source="$1"
  local companion
  for companion in "${LINK_LOCAL_COMPANION_REPOS[@]}"; do
    if ! declares_package "$companion"; then
      continue
    fi
    if manifest_includes_sibling "$companion"; then
      continue
    fi
    local companion_source
    companion_source="$(companion_source_for "$companion" "$jskit_source" || true)"
    if [ -z "$companion_source" ]; then
      fail "The app declares $companion, but no development source was found. Set $(repo_env_prefix "$companion")_ROOT or $TARGET_CONFIG_DIR/devel_sibling_roots/$companion."
    fi
    clone_or_reuse_sibling "$companion" "$companion_source"
  done
}

link_sibling_node_modules_to_worktree() {
  local sibling_repo="$1"
  local sibling_node_modules="$sibling_repo/node_modules"
  local worktree_node_modules="$JSKIT_WORKTREE_ROOT/node_modules"

  if [ ! -d "$worktree_node_modules" ]; then
    fail "Session worktree dependencies are missing at $worktree_node_modules."
  fi

  rm -rf "$sibling_node_modules"
  ln -s "$worktree_node_modules" "$sibling_node_modules"
  log "Linked sibling node_modules to the session worktree install."
}

ensure_clean_local_source() {
  local name="$1"
  local source="$2"
  local dirty
  dirty="$(git -C "$source" status --porcelain)"
  if [ -n "$dirty" ]; then
    fail "Session provisioning needs a clean sibling source for $name. The source checkout at $source has uncommitted changes, and a session-owned clone can only reproduce committed state. Commit or stash the sibling repo changes, then retry provisioning."
  fi
}

clone_or_reuse_sibling() {
  local name="$1"
  local source_ref="$2"
  local dest="$SIBLING_ROOT/$name"
  local marker_path="$SIBLING_ROOT/$name.pr_url"
  local base_path="$SIBLING_ROOT/$name.base"
  local local_source=""

  if manifest_includes_sibling "$name"; then
    return
  fi

  if ! [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]]; then
    fail "Invalid sibling repo name '$name'. Use letters, numbers, dots, underscores, and hyphens."
  fi

  mkdir -p "$SIBLING_ROOT"
  if git -C "$source_ref" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    local_source="$(cd "$source_ref" && pwd -P)"
  fi

  if [ -e "$dest" ] && ! git -C "$dest" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    fail "Sibling destination exists but is not a git worktree: $dest"
  fi

  if [ ! -e "$dest" ]; then
    if [ -n "$local_source" ]; then
      ensure_clean_local_source "$name" "$local_source"
      log "Cloning sibling $name from local source $local_source."
      git clone "$local_source" "$dest" >/dev/null
      local origin_url
      origin_url="$(git -C "$local_source" remote get-url origin 2>/dev/null || true)"
      if [ -n "$origin_url" ]; then
        git -C "$dest" remote set-url origin "$origin_url"
      fi
    else
      log "Cloning sibling $name from $source_ref."
      git clone "$source_ref" "$dest" >/dev/null
    fi
  else
    log "Reusing existing sibling clone for $name at $dest."
  fi

  local branch="jskit-studio/${JSKIT_SESSION_ID}/${name}"
  if git -C "$dest" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$dest" switch "$branch" >/dev/null
  else
    git -C "$dest" switch -c "$branch" >/dev/null
  fi

  if [ ! -f "$base_path" ]; then
    git -C "$dest" rev-parse HEAD > "$base_path"
  fi
  local base_commit
  base_commit="$(sed -n '1p' "$base_path")"

  printf '%s\t%s\t%s\t%s\n' "$name" "$dest" "$base_commit" "$marker_path" >> "$SIBLING_MANIFEST.tmp"

  if [ "$name" = "jskit-ai" ]; then
    ensure_link_local_companions "$local_source"
    mkdir -p "$WORKTREE_CONFIG_DIR"
    printf '%s\n' "$dest" > "$WORKTREE_CONFIG_DIR/devel_jskit_ai_root"
    log "Linking jskit-ai packages into the Studio session worktree."
    (cd "$JSKIT_WORKTREE_ROOT" && npx --no-install jskit app link-local-packages --repo-root "$dest")
    link_sibling_node_modules_to_worktree "$dest"
  fi
}

copy_target_config

mapfile -t siblings < <(configured_siblings)
if [ "${#siblings[@]}" -eq 0 ]; then
  log "No development sibling repos configured."
  exit 0
fi

mkdir -p "$SIBLING_ROOT"
: > "$SIBLING_MANIFEST.tmp"

for sibling in "${siblings[@]}"; do
  sibling_source="$(sibling_source_for "$sibling" || true)"
  if [ -z "$sibling_source" ]; then
    fail "Sibling repo '$sibling' is configured, but no source was provided. Set $(repo_env_prefix "$sibling")_ROOT or $TARGET_CONFIG_DIR/devel_sibling_roots/$sibling."
  fi
  clone_or_reuse_sibling "$sibling" "$sibling_source"
done

mv "$SIBLING_MANIFEST.tmp" "$SIBLING_MANIFEST"
provisioned_count="$(awk 'END { print NR + 0 }' "$SIBLING_MANIFEST")"
log "Provisioned $provisioned_count development sibling repo(s)."
