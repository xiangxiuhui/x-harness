#!/usr/bin/env bash
#
# refs.sh — manage refs/ submodules (the "reference projects" library).
#
# Why this exists:
#   The 5 ref repos are git submodules of x_harness, but their default branches
#   differ (opencode = dev, others = main) and the parent repo only re-pins
#   SHAs when we run `git add refs/<ref>`. A weak-network environment also
#   makes ad-hoc `git submodule update --remote` painful — output gets
#   buffered and partial-clones leave stale state behind.
#
#   This script is a thin, idempotent wrapper that does the three things we
#   actually need: list, update (one or all), add, remove. Verbose by default,
#   safe to ^C and re-run.
#
# Usage:
#   ./scripts/refs.sh list                       # show pinned SHA, upstream HEAD, drift
#   ./scripts/refs.sh status                     # alias for list
#   ./scripts/refs.sh pull [<name>]              # fetch + checkout upstream tip; auto-detects branch
#   ./scripts/refs.sh pin   [<name>]             # stage SHA bump in parent repo
#   ./scripts/refs.sh add   <name> <url> [<branch>]   # add a new submodule under refs/<name>
#   ./scripts/refs.sh rm    <name>               # remove submodule cleanly
#   ./scripts/refs.sh doctor                     # diagnose common issues (stale .git/modules etc.)
#
# Examples:
#   ./scripts/refs.sh list
#   ./scripts/refs.sh pull                       # update all
#   ./scripts/refs.sh pull codex                 # update just codex
#   ./scripts/refs.sh add opencode https://github.com/anomalyco/opencode.git dev
#   ./scripts/refs.sh rm hermes-agent
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REFS_DIR="$ROOT/refs"
GITMODULES="$ROOT/.gitmodules"

# Colors (auto-detect TTY)
if [ -t 1 ]; then
  C_R="\033[31m"; C_G="\033[32m"; C_Y="\033[33m"; C_B="\033[34m"; C_D="\033[2m"; C_X="\033[0m"
else
  C_R=""; C_G=""; C_Y=""; C_B=""; C_D=""; C_X=""
fi
say()  { printf "%b\n" "$*"; }
ok()   { say "${C_G}✓${C_X} $*"; }
warn() { say "${C_Y}!${C_X} $*"; }
err()  { say "${C_R}✗${C_X} $*" >&2; }
hdr()  { say "${C_B}▸${C_X} $*"; }

#------------------------------------------------------------------------------
# helpers
#------------------------------------------------------------------------------

list_submodules() {
  # Emits "name url branch" one per line.
  # branch defaults to upstream HEAD if unset in .gitmodules.
  git -C "$ROOT" config -f "$GITMODULES" --name-only --get-regexp '^submodule\..*\.path$' \
    | sed -E 's/^submodule\.(.*)\.path$/\1/' \
    | while read -r key; do
        path=$(git -C "$ROOT" config -f "$GITMODULES" --get "submodule.$key.path")
        url=$(git  -C "$ROOT" config -f "$GITMODULES" --get "submodule.$key.url")
        branch=$(git -C "$ROOT" config -f "$GITMODULES" --get "submodule.$key.branch" || echo "")
        # name = basename of path (refs/<name>)
        name=$(basename "$path")
        printf "%s\t%s\t%s\n" "$name" "$url" "$branch"
      done
}

submodule_path() {
  # name -> "refs/<name>" (absolute)
  echo "$REFS_DIR/$1"
}

resolve_branch() {
  # name -> branch (from .gitmodules, falling back to remote HEAD lookup)
  local name="$1"
  local key
  key=$(git -C "$ROOT" config -f "$GITMODULES" --name-only --get-regexp '^submodule\..*\.path$' \
        | sed -E 's/^submodule\.(.*)\.path$/\1/' \
        | while read -r k; do
            p=$(git -C "$ROOT" config -f "$GITMODULES" --get "submodule.$k.path")
            [ "$(basename "$p")" = "$name" ] && echo "$k" && break
          done)
  if [ -z "$key" ]; then return 1; fi
  local branch
  branch=$(git -C "$ROOT" config -f "$GITMODULES" --get "submodule.$key.branch" 2>/dev/null || true)
  if [ -n "$branch" ]; then echo "$branch"; return 0; fi
  # fall back: ask remote for default branch
  local p; p=$(submodule_path "$name")
  if [ -d "$p/.git" ] || [ -f "$p/.git" ]; then
    branch=$(git -C "$p" remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')
    if [ -n "$branch" ]; then echo "$branch"; return 0; fi
  fi
  echo "main"  # last-resort default
}

#------------------------------------------------------------------------------
# subcommands
#------------------------------------------------------------------------------

cmd_list() {
  if [ ! -f "$GITMODULES" ]; then warn "no .gitmodules"; return 0; fi
  hdr "submodules under refs/:"
  printf "  %-16s  %-9s  %-12s  %-12s  %s\n" "NAME" "BRANCH" "LOCAL" "UPSTREAM" "STATE"
  list_submodules | while IFS=$'\t' read -r name url branch; do
    local_dir=$(submodule_path "$name")
    if [ ! -d "$local_dir/.git" ] && [ ! -f "$local_dir/.git" ]; then
      printf "  %-16s  %-9s  %-12s  %-12s  ${C_Y}%s${C_X}\n" "$name" "${branch:-?}" "(none)" "(unknown)" "not-initialized"
      continue
    fi
    local_sha=$(git -C "$local_dir" rev-parse --short=10 HEAD 2>/dev/null || echo "?")
    eff_branch="$branch"
    [ -z "$eff_branch" ] && eff_branch=$(git -C "$local_dir" remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')
    [ -z "$eff_branch" ] && eff_branch="main"
    upstream_sha=$(git -C "$local_dir" rev-parse --short=10 "origin/$eff_branch" 2>/dev/null || echo "?")
    state="up-to-date"
    color="$C_G"
    if [ "$local_sha" != "$upstream_sha" ] && [ "$upstream_sha" != "?" ]; then
      state="behind"
      color="$C_Y"
    fi
    # Parent index drift (parent repo's pinned SHA vs working SHA)
    parent_sha=$(git -C "$ROOT" ls-tree HEAD "refs/$name" 2>/dev/null | awk '{print $3}' | cut -c1-10 || echo "")
    if [ -n "$parent_sha" ] && [ "$parent_sha" != "$local_sha" ]; then
      state="$state, parent-stale"
      color="$C_Y"
    fi
    printf "  %-16s  %-9s  %-12s  %-12s  ${color}%s${C_X}\n" "$name" "$eff_branch" "$local_sha" "$upstream_sha" "$state"
  done
}

cmd_pull_one() {
  local name="$1"
  local dir; dir=$(submodule_path "$name")
  if [ ! -d "$dir/.git" ] && [ ! -f "$dir/.git" ]; then
    err "$name: not initialized; run \`git submodule update --init refs/$name\` first"
    return 1
  fi
  local branch; branch=$(resolve_branch "$name")
  hdr "pull $name (branch=$branch)"
  ( cd "$dir" && git fetch --quiet origin "$branch" \
                && git checkout --quiet "$branch" \
                && git pull --ff-only --quiet origin "$branch" ) \
    && ok "$name -> $(git -C "$dir" rev-parse --short=10 HEAD)" \
    || err "$name: pull failed"
}

cmd_pull() {
  if [ $# -ge 1 ] && [ "$1" != "" ]; then
    cmd_pull_one "$1"
  else
    list_submodules | while IFS=$'\t' read -r name url branch; do
      cmd_pull_one "$name" || true
    done
  fi
}

cmd_pin_one() {
  local name="$1"
  local rel="refs/$name"
  if ! git -C "$ROOT" diff --quiet -- "$rel"; then
    git -C "$ROOT" add "$rel"
    ok "pinned $name @ $(git -C "$ROOT/$rel" rev-parse --short=10 HEAD) (staged)"
  else
    say "  $name: no change to pin"
  fi
}

cmd_pin() {
  if [ $# -ge 1 ] && [ "$1" != "" ]; then
    cmd_pin_one "$1"
  else
    list_submodules | while IFS=$'\t' read -r name url branch; do
      cmd_pin_one "$name"
    done
    if ! git -C "$ROOT" diff --cached --quiet; then
      hdr "staged. review with: git diff --cached"
      hdr "commit with:         git commit -m 'refs: bump'"
    fi
  fi
}

cmd_add() {
  [ $# -ge 2 ] || { err "usage: refs.sh add <name> <url> [<branch>]"; exit 2; }
  local name="$1" url="$2" branch="${3:-}"
  local dir="refs/$name"
  if [ -e "$ROOT/$dir" ]; then err "$dir already exists; remove first or pick a different name"; exit 1; fi
  hdr "adding submodule $dir from $url ${branch:+(branch=$branch)}"
  ( cd "$ROOT" && git submodule add "$url" "$dir" )
  if [ -n "$branch" ]; then
    ( cd "$ROOT" && git -C "$dir" checkout "$branch" )
    git -C "$ROOT" config -f .gitmodules submodule."$dir".branch "$branch"
    git -C "$ROOT" add .gitmodules "$dir"
  fi
  ok "added $name. commit with: git commit -m 'refs: add $name submodule'"
}

cmd_rm() {
  [ $# -ge 1 ] || { err "usage: refs.sh rm <name>"; exit 2; }
  local name="$1"
  local rel="refs/$name"
  if [ ! -e "$ROOT/$rel" ] && ! grep -q "\[submodule \"$rel\"\]" "$GITMODULES" 2>/dev/null; then
    err "$name: not found"; exit 1
  fi
  hdr "removing submodule $rel"
  ( cd "$ROOT" && git submodule deinit -f "$rel" 2>/dev/null || true )
  ( cd "$ROOT" && git rm -f "$rel" 2>/dev/null || rm -rf "$rel" )
  rm -rf "$ROOT/.git/modules/$rel"
  # ensure .gitmodules entry gone
  if grep -q "\[submodule \"$rel\"\]" "$GITMODULES" 2>/dev/null; then
    git -C "$ROOT" config -f .gitmodules --remove-section "submodule.$rel" 2>/dev/null || true
    git -C "$ROOT" add .gitmodules
  fi
  ok "removed $name. commit with: git commit -m 'refs: remove $name submodule'"
}

cmd_doctor() {
  hdr "checking refs/ health"
  local issues=0
  # 1. .gitmodules entries match refs/* on disk
  list_submodules | while IFS=$'\t' read -r name url branch; do
    if [ ! -e "$REFS_DIR/$name" ]; then
      warn "$name listed in .gitmodules but refs/$name missing on disk (run: git submodule update --init refs/$name)"
      issues=$((issues+1))
    fi
  done
  # 2. stale .git/modules dirs without a .gitmodules entry
  if [ -d "$ROOT/.git/modules/refs" ]; then
    for d in "$ROOT/.git/modules/refs"/*; do
      [ -d "$d" ] || continue
      local nm; nm=$(basename "$d")
      if ! grep -q "path = refs/$nm$" "$GITMODULES" 2>/dev/null; then
        warn "stale .git/modules/refs/$nm — no matching submodule (consider: rm -rf .git/modules/refs/$nm)"
        issues=$((issues+1))
      fi
    done
  fi
  # 3. untracked dirs under refs/ that look like clones
  for d in "$REFS_DIR"/*; do
    [ -d "$d" ] || continue
    local nm; nm=$(basename "$d")
    if ! grep -q "path = refs/$nm$" "$GITMODULES" 2>/dev/null; then
      warn "refs/$nm exists but is NOT a registered submodule"
      issues=$((issues+1))
    fi
  done
  [ "$issues" -eq 0 ] && ok "all clean"
}

#------------------------------------------------------------------------------
# dispatch
#------------------------------------------------------------------------------

case "${1:-list}" in
  list|status|ls) shift || true; cmd_list "$@" ;;
  pull|update)    shift; cmd_pull "${1:-}" ;;
  pin|stage)      shift; cmd_pin  "${1:-}" ;;
  add)            shift; cmd_add  "$@" ;;
  rm|remove|del)  shift; cmd_rm   "$@" ;;
  doctor|check)   shift || true; cmd_doctor ;;
  -h|--help|help) sed -n '1,40p' "$0"; ;;
  *)              err "unknown command: $1"; sed -n '15,30p' "$0"; exit 2 ;;
esac
