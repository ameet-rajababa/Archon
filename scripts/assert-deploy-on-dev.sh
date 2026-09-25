#!/usr/bin/env bash
#
# Refuse to deploy a commit that is not already on dev.
#
# THE INVARIANT:  `git rev-list dev..<the commit being deployed>` is empty.
#
# WHY THIS EXISTS. `deploy` was a branch people committed to directly, because
# doing so shipped instantly while the reviewed path — a PR to `dev` — shipped
# nothing. It drifted 204 commits and 307 files ahead of `dev`, and two merged
# PRs sat on `dev` running nowhere. The inversion taught everyone the wrong
# lesson, so the branch is now a POINTER at a commit `dev` already has.
#
# There is no exception list, because nothing on `deploy` was ever deploy-only:
# no secrets, no host configuration, only ordinary project code.
#
# There is deliberately NO bypass flag either. A way to skip this is the same
# instant path that caused the drift; the way past it is to merge to `dev`
# first. Enforced here rather than written down because prose does not refuse.
#
# Usage:  scripts/assert-deploy-on-dev.sh [commit]      (default HEAD)
# Env:    REMOTE (default fork), DEV_BRANCH (default dev)
set -euo pipefail

REMOTE="${REMOTE:-fork}"
DEV_BRANCH="${DEV_BRANCH:-dev}"
ARG="${1:-HEAD}"

if ! target=$(git rev-parse --verify --quiet "$ARG^{commit}"); then
  echo "assert-deploy-on-dev: not a commit: $ARG" >&2
  exit 1
fi

# Refresh the remote's dev before judging, so a checkout that has not fetched in
# a day does not refuse a commit dev already has. A failed fetch is a note and
# not a failure: a stale ref can only make this check STRICTER, never laxer.
# The refspec is spelled out rather than left to the remote's configured one: a
# shallow CI checkout configures a narrow refspec, and `git fetch <remote> dev`
# there lands in FETCH_HEAD without ever creating the remote-tracking ref this
# then looks for.
if ! git fetch --quiet "$REMOTE" \
  "+refs/heads/$DEV_BRANCH:refs/remotes/$REMOTE/$DEV_BRANCH" 2>/dev/null; then
  echo "note: could not fetch $REMOTE/$DEV_BRANCH — judging against the ref this checkout already has" >&2
fi

dev=""
for ref in "refs/remotes/$REMOTE/$DEV_BRANCH" "refs/heads/$DEV_BRANCH"; do
  if dev=$(git rev-parse --verify --quiet "$ref"); then
    dev_ref="$ref"
    break
  fi
  dev=""
done

# No dev to compare against means this check proves nothing, so it refuses
# rather than passing. Failing open here would restore exactly the hole it is
# here to close.
if [ -z "$dev" ]; then
  echo "assert-deploy-on-dev: cannot resolve $DEV_BRANCH" >&2
  echo "  tried refs/remotes/$REMOTE/$DEV_BRANCH and refs/heads/$DEV_BRANCH" >&2
  echo "  Refusing: with no dev to compare against this check would prove nothing." >&2
  exit 1
fi

extra=$(git rev-list --count "$dev..$target")
if [ "$extra" != "0" ]; then
  echo "assert-deploy-on-dev: REFUSED — $extra commit(s) are not on $dev_ref" >&2
  git rev-list --format='  %h %s' --no-commit-header "$dev..$target" | head -20 >&2
  if [ "$extra" -gt 20 ]; then
    echo "  ... and $((extra - 20)) more" >&2
  fi
  echo >&2
  echo "  deploy is a pointer at a commit dev already has. Open a PR to $DEV_BRANCH," >&2
  echo "  merge it, then deploy the merged commit." >&2
  exit 1
fi

echo "assert-deploy-on-dev OK: ${target:0:12} is already on $dev_ref"
