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

printf '%s\n' "$SHA" >"$REQUEST"

echo "requested $SHA"
git log --oneline -1
echo
echo "The host deploys in ~30s and the restart will kill this session."
echo "When the console is back: cat /.archon/deploy-last.log"
