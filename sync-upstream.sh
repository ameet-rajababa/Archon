#!/usr/bin/env bash
# Pull Cole's latest into the integrated console branch, weekly.
#
# WHY NOT AUTO-MERGE ON CONFLICT: a conflict resolved unattended in a branch
# that is deployed straight to the running container is how a broken UI goes
# live at 3am. A clean merge is safe and is taken; anything else is reported
# and left for a person.
set -euo pipefail

REPO=/home/appuser/archon-upstream
BRANCH=local/deploy

cd "$REPO"
git fetch -q origin dev

behind=$(git rev-list --count HEAD..origin/dev)
ahead=$(git rev-list --count origin/dev..HEAD)
echo "$BRANCH: $ahead ahead, $behind behind origin/dev"

if [ "$behind" -eq 0 ]; then
  echo "nothing to pull"
  exit 0
fi

echo "--- what is new upstream ---"
git log --oneline HEAD..origin/dev | head -40

# Never merge over someone else's work in progress: this checkout is shared
# with other agent sessions, which switch branches and leave edits behind.
if [ -n "$(git status --porcelain)" ]; then
  echo "REFUSING TO MERGE: the working tree is dirty"
  git status --short
  exit 1
fi
if [ "$(git rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]; then
  echo "REFUSING TO MERGE: on $(git rev-parse --abbrev-ref HEAD), not $BRANCH"
  exit 1
fi

# Dry-run the merge first so a conflict never leaves the branch half-merged.
if ! git merge-tree --write-tree HEAD origin/dev >/dev/null 2>&1; then
  echo "CONFLICTS — not merging. Resolve by hand:"
  echo "  git -C $REPO merge origin/dev"
  exit 1
fi

git merge --no-edit origin/dev
echo "merged. Rebuild and redeploy to pick it up:"
echo "  bash /home/appuser/deploy-console.sh"
