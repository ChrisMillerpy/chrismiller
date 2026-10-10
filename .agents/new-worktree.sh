#!/usr/bin/env bash
# Create a worktree on a fresh branch and symlink the main checkout's env files into it.
#
# Usage: .agents/new-worktree.sh <branch> [base-branch]
#   branch       name of the new branch (also the worktree dir name)
#   base-branch  branch to fork from (default: main)
#
# The worktree is created at .claude/worktrees/<branch>. Every .env and .env.*
# file in the main checkout (except .env.example) is symlinked to the same
# relative path in the worktree.
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: $0 <branch> [base-branch]" >&2
  exit 1
fi

branch="$1"
base="${2:-main}"

# Resolve the main checkout even when run from inside another worktree.
root="$(cd "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")" && pwd)"
worktree="$root/.claude/worktrees/$branch"

if git -C "$root" show-ref --verify --quiet "refs/heads/$branch"; then
  echo "error: branch '$branch' already exists" >&2
  exit 1
fi
if [[ -e "$worktree" ]]; then
  echo "error: $worktree already exists" >&2
  exit 1
fi

# Fork from the freshest copy of base: origin/<base> if it exists, else local.
start="$base"
if git -C "$root" remote get-url origin >/dev/null 2>&1 \
  && git -C "$root" fetch --quiet origin "$base" 2>/dev/null; then
  start="origin/$base"
fi

git -C "$root" worktree add --no-track -b "$branch" "$worktree" "$start"

count=0
while IFS= read -r -d '' src; do
  rel="${src#"$root"/}"
  dest="$worktree/$rel"
  mkdir -p "$(dirname "$dest")"
  ln -sfn "$src" "$dest"
  echo "linked $rel"
  count=$((count + 1))
done < <(
  find "$root" \
    \( -path "$root/.git" -o -path "$root/.claude" -o -name node_modules \) -prune -o \
    -type f \( -name '.env' -o -name '.env.*' \) ! -name '.env.example' -print0
)

echo "worktree ready: $worktree ($branch from $start, $count env file(s) linked)"
