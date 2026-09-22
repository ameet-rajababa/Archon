#!/usr/bin/env bash
#
# Ask the host to deploy this checkout's HEAD. Runs INSIDE the container.
#
# The container cannot deploy itself — no docker, no socket, no sudo — so it
# writes one file naming the commit it wants running, and a systemd .path unit
# on the host picks it up. See scripts/deploy-on-request.sh for the other half.
#
# Writes HEAD and never a SHA given on the command line. The request exists to
# say "the commit I just made", and a hand-typed SHA is the one thing that
# cannot be checked against what the asker actually meant.
#
# THIS SCRIPT DIES WITH THE DEPLOY. The rebuild restarts the container it is
# running in, so it cannot report the outcome — it prints where the outcome
# will be instead. Read /.archon/deploy-last.log once the console is back.
set -euo pipefail

VOLUME="${VOLUME:-/.archon}"
REQUEST="$VOLUME/deploy-request"
# Same defaults as deploy-local.sh, which pushes to the same place: the host
# pulls `$REMOTE_BRANCH` from the public fork, so both halves have to name it
# identically or the host fetches a branch nobody wrote to.
REMOTE="${REMOTE:-fork}"
REMOTE_BRANCH="${REMOTE_BRANCH:-deploy}"

SHA=$(git rev-parse HEAD)

if [ -e "$REQUEST" ]; then
  echo "A request is already pending ($(cat "$REQUEST")) — the host has not consumed it yet." >&2
  exit 1
fi

DIRTY=$(git status --porcelain --untracked-files=no | wc -l | tr -d ' ')
if [ "$DIRTY" != "0" ]; then
  # A warning, not a failure: this checkout is shared, so "clean" is a state it
  # is never in, and most of those files belong to somebody else. The trap is
  # expecting an edit that was never committed to be in the deploy.
  echo "note: $DIRTY uncommitted file(s) — they will NOT be deployed"
fi

# THE PUSH BELONGS HERE, not in the host's deploy. This container is the half
# that holds GitHub credentials: the session's token is injected per call by the
# env-var store and is NOT in the container's own environment, so a push issued
# by the host through `docker compose exec` sees only the stale token the image
# was built with. Two deploys died there — one on a rotated token, one on no
# credential at all — while a working token sat in the asking session the whole
# time.
#
# The host needs none of this. The fork is public, so reading it and pulling
# from it authenticate against nothing.
#
# Tokens are tried by NAME, in order, and the first that authenticates wins.
# "A token is set" is not evidence: the container's GH_TOKEN has outlived its
# replacement once already, and returns 401 while looking perfectly present.
# The push itself is the only proof, so that is what decides.
remote_url=$(git remote get-url "$REMOTE") || exit 1
pushed=""
attempts=""

for var in GITHUB_PAT GH_TOKEN GITHUB_TOKEN; do
  token="${!var:-}"
  [ -n "$token" ] || continue
  url="https://x-access-token:${token}@${remote_url#https://}"
  # Output is redacted before it is shown: a failed push echoes the URL it
  # tried, and that URL carries the token.
  if out=$(GIT_TERMINAL_PROMPT=0 git push "$url" "HEAD:$REMOTE_BRANCH" 2>&1); then
    pushed="$var"
    break
  fi
  attempts="$attempts $var"
  last=$(printf '%s' "$out" | sed "s#${token}#<redacted>#g" | tail -1)
done

if [ -z "$pushed" ]; then
  # No request is written. A request naming a commit the host cannot fetch is a
  # deploy that fails four steps later for a reason recorded somewhere nobody
  # is looking.
  echo "Could not push to $REMOTE/$REMOTE_BRANCH. Tried:${attempts:- nothing — no token is set}" >&2
  [ -n "${last:-}" ] && echo "last error: $last" >&2
  exit 1
fi

echo "pushed $SHA to $REMOTE/$REMOTE_BRANCH (via $pushed)"

printf '%s\n' "$SHA" >"$REQUEST"

echo "requested $SHA"
git log --oneline -1
echo
echo "The host deploys in ~30s and the restart will kill this session."
echo "When the console is back: cat /.archon/deploy-last.log"
