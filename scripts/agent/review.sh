#!/usr/bin/env bash
# Quick autopilot review — shows what the agent has done since main diverged.
# Usage:  bash scripts/agent/review.sh

set -u
BRANCH="${1:-x402-api-gateway}"
BASE="${2:-main}"

echo "=== autopilot review: $BRANCH vs $BASE ==="
echo
echo "--- commits on $BRANCH not in $BASE ---"
git log --oneline "$BASE..$BRANCH"
echo
echo "--- files changed ---"
git diff --stat "$BASE..$BRANCH"
echo
echo "--- secret scan on whole delta ---"
if [ -x docker/secret-scan.sh ]; then
  bash docker/secret-scan.sh "$BASE"
else
  echo "(docker/secret-scan.sh not executable, skipping)"
fi
echo
echo "To merge clean commits: git checkout $BASE && git merge --no-ff $BRANCH"
echo "To drop a bad commit:   git revert <sha>"
echo "To nuke everything:     git branch -D $BRANCH && git checkout -b $BRANCH $BASE"
