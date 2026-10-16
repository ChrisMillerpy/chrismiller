/**
 * Puts the box on the chat's branch. Switches only if it isn't already there, so
 * uncommitted work is never thrown away. A new branch starts from the latest main
 * and is pushed to GitHub; if that push fails (no token, no permission), the box
 * still works locally and open_pr reports the problem later.
 * Env: BRANCH (required), WORKSPACE (default /workspace), GH_TOKEN (optional).
 */
export const PREPARE = `set -e
cd "\${WORKSPACE:-/workspace}"
[ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] && exit 0
git fetch -q --depth 50 origin "+refs/heads/main:refs/remotes/origin/main"
if git fetch -q --depth 50 origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" 2>/dev/null; then
  git checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  git checkout -q -B "$BRANCH" origin/main
  if [ -n "$GH_TOKEN" ]; then
    git push -q -u origin "$BRANCH" 2>/tmp/push.err || echo "Note: could not push $BRANCH to GitHub yet: $(tail -1 /tmp/push.err)"
  fi
fi`;
