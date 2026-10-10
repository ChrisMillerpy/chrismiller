#!/usr/bin/env bash
# Set up a worktree for a branch and symlink the main checkout's env files into it.
#
# Usage: .agents/new-worktree.sh <branch> [base-branch]
#   branch       branch to set up (also the worktree dir name for new worktrees)
#   base-branch  branch to fork from when <branch> is new (default: main)
#
# - <branch> already checked out in a worktree: only (re)link env files there.
# - <branch> exists but has no worktree: add one at .claude/worktrees/<branch>.
# - <branch> doesn't exist: fork it from <base-branch> into .claude/worktrees/<branch>.
#
# Every .env and .env.* file in the main checkout (except .env.example) is
# symlinked to the same relative path in the worktree. Real (non-symlink) env
# files already in the worktree are left alone.
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: $0 <branch> [base-branch]" >&2
  exit 1
fi

branch="$1"
base="${2:-main}"

# Resolve the main checkout even when run from inside another worktree.
root="$(cd "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")" && pwd)"

# Path of the worktree that has <branch> checked out, if any.
worktree="$(git -C "$root" worktree list --porcelain | awk -v ref="refs/heads/$branch" '
  /^worktree / { path = substr($0, 10) }
  $0 == "branch " ref { print path; exit }
')"

if [[ -n "$worktree" ]]; then
  if [[ "$worktree" == "$root" ]]; then
    echo "error: '$branch' is checked out in the main checkout" >&2
    exit 1
  fi
  status="existing worktree"
else
  worktree="$root/.claude/worktrees/$branch"
  if [[ -e "$worktree" ]]; then
    echo "error: $worktree already exists" >&2
    exit 1
  fi
  if git -C "$root" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$root" worktree add "$worktree" "$branch"
    status="existing branch $branch"
  else
    # Fork from the freshest copy of base: origin/<base> if it exists, else local.
    start="$base"
    if git -C "$root" remote get-url origin >/dev/null 2>&1 \
      && git -C "$root" fetch --quiet origin "$base" 2>/dev/null; then
      start="origin/$base"
    fi
    git -C "$root" worktree add --no-track -b "$branch" "$worktree" "$start"
    status="$branch from $start"
  fi
fi

count=0
while IFS= read -r -d '' src; do
  rel="${src#"$root"/}"
  dest="$worktree/$rel"
  if [[ -e "$dest" && ! -L "$dest" ]]; then
    echo "skipped $rel (real file exists in worktree)"
    continue
  fi
  mkdir -p "$(dirname "$dest")"
  ln -sfn "$src" "$dest"
  echo "linked $rel"
  count=$((count + 1))
done < <(
  find "$root" \
    \( -path "$root/.git" -o -path "$root/.claude" -o -name node_modules \) -prune -o \
    -type f \( -name '.env' -o -name '.env.*' \) ! -name '.env.example' -print0
)

echo "worktree ready: $worktree ($status, $count env file(s) linked)"
