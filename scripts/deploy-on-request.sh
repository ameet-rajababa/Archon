#!/usr/bin/env bash
#
# Deploy what the container asked for. Runs on the HOST, as root, started by
# archon-deploy.path the moment the request file appears.
#
# WHY THIS EXISTS. A session inside the container can commit but cannot deploy:
# no docker binary, no socket, no sudo, and it would be asking Docker to
# replace the image it is executing in. This is the seam. The container's only
# power is to write one file naming a commit; the host decides whether to act
# on it, and this script is that decision.
#
# THE PROTOCOL, one file:
#   <volume>/deploy-request   written by the container, contains ONE 40-char
#                             SHA — the commit it wants running. Consumed here.
#   <volume>/deploy-last.log  everything the deploy printed. The container reads
#                             it afterwards, because the deploy restarts the
#                             container and kills whatever asked for it.
#   <volume>/deploy-history   one line per attempt, appended, never truncated.
#
# THE SHA IS THE POINT. Several sessions share the source checkout and HEAD
# moves under them, so "deploy whatever is at HEAD" can ship a commit nobody in
# this conversation wrote. The request names the commit the asker meant; if the
# checkout has moved since, this refuses rather than shipping the difference.
set -uo pipefail

VOLUME="${VOLUME:-/var/lib/docker/volumes/archon_archon_data/_data}"
REQUEST="${REQUEST:-$VOLUME/deploy-request}"
LOG="${LOG:-$VOLUME/deploy-last.log}"
PREV_LOG="${PREV_LOG:-$VOLUME/deploy-prev.log}"
HISTORY="${HISTORY:-$VOLUME/deploy-history}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/archon}"
DEPLOY="${DEPLOY:-$DEPLOY_DIR/scripts/deploy-local.sh}"
SOURCE_DIR="${SOURCE_DIR:-/home/appuser/archon-upstream}"
SERVICE="${SERVICE:-app}"
# There is no grace period here any more. It was a fixed 30s sleep, guessing at
# how long the asking session needed to finish speaking; deploy-local.sh now
# WAITS for that to be true rather than assuming it, and will not swap while any
# chat holds the conversation lock. The steps before the wait — preflight,
# remote, pull, build — disturb nothing and take minutes, so starting them
# immediately is strictly better than sleeping first.

now() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
note() { printf '%s  %s\n' "$(now)" "$1"; }
record() { printf '%s  %s\n' "$(now)" "$1" >>"$HISTORY"; }

# CONSUMED FIRST, before anything can fail. A request that outlives its own
# attempt re-arms the .path unit the instant the service exits, and the box
# deploys in a loop for as long as the file exists.
[ -f "$REQUEST" ] || exit 0
WANT=$(tr -d ' \r\n' <"$REQUEST" 2>/dev/null)
rm -f "$REQUEST"

# One deploy at a time. Two requests inside one build would have docker compose
# fighting itself over the same service.
exec 9>"$VOLUME/.deploy.lock"
if ! flock -n 9; then
  record "REFUSED ${WANT:-?} — a deploy is already running"
  exit 0
fi

# One attempt per log, with the attempt BEFORE it kept beside it. The container
# reads $LOG to find out how the deploy it could not watch turned out, and the
# next request used to overwrite the losing attempt before anyone had read it:
# on 2026-09-23 a deploy reported failure, a second request arrived five minutes
# later, and the only record of why the first failed was gone. One extra file is
# the difference between a diagnosable failure and a guess. The history file is
# still the one that accumulates.
[ -f "$LOG" ] && mv -f "$LOG" "$PREV_LOG"
exec >"$LOG" 2>&1

note "request: ${WANT:-<empty>}"

if ! printf '%s' "$WANT" | grep -Eq '^[0-9a-f]{40}$'; then
  note "STOPPED: not a commit SHA — refusing to guess what was meant"
  record "REFUSED ${WANT:-<empty>} — malformed request"
  exit 1
fi

# Every question put to the container goes through here, so the two things that
# are easy to get wrong are spelled once.
#
# `cd` rather than `-f`. An explicit -f makes compose IGNORE
# docker-compose.override.yml, and this install keeps the /opt/archon bind
# mount in the override — so a command spelled that way silently addresses a
# different desired state than the one the deploy itself uses. It cost an
# afternoon: a compose invocation with -f recreated the app container without
# the mount, and the next deploy's `git -C /opt/archon` ran in a container
# where that path no longer existed.
#
# And safe.directory, because the two checkouts are owned by different users and
# root is neither.
in_container() {
  (cd "$DEPLOY_DIR" && docker compose exec -T -u root "$SERVICE" \
    sh -lc "git config --global --add safe.directory '*' >/dev/null 2>&1; $1" 2>/dev/null) \
    | tr -d ' \r\n'
}

# What the checkout actually holds RIGHT NOW. Asked of the container rather
# than of anything cached, for the same reason deploy-local.sh asks GitHub and
# the running image their own questions: a step that cannot be confirmed is a
# step that has silently not happened.
HEAD=$(in_container "git -C '$SOURCE_DIR' rev-parse HEAD")

if [ -z "$HEAD" ]; then
  note "STOPPED: could not read the source HEAD — is the container running?"
  record "FAILED $WANT — source HEAD unreadable"
  exit 1
fi

if [ "$HEAD" != "$WANT" ]; then
  note "STOPPED: asked for $WANT, checkout is at $HEAD"
  note "The checkout moved after the request was written — another session"
  note "committed. Deploying now would ship work nobody here asked for."
  record "REFUSED $WANT — checkout had moved to $HEAD"
  exit 1
fi

note "checkout confirms $HEAD"
note "starting deploy"
if bash "$DEPLOY"; then
  note "DEPLOYED $WANT"
  record "OK $WANT"
else
  status=$?
  # What the box is ACTUALLY running, asked rather than assumed. deploy-local.sh
  # can fail AFTER `up -d` has already swapped the container — its health wait
  # and its verification both run past that point — so "running whatever it was
  # before" is a claim this script never checked. On 2026-09-23 it was false:
  # the swap had happened, the new image was live, and the report said the
  # opposite.
  RUNNING=$(in_container "cat /app/.deployed-sha")
  case "$RUNNING" in
    "$WANT") note "DEPLOY FAILED (exit $status) — but the swap DID happen: the box is running $WANT" ;;
    '') note "DEPLOY FAILED (exit $status) — and the box cannot say what it is running" ;;
    *) note "DEPLOY FAILED (exit $status) — the box is running $RUNNING" ;;
  esac
  # The failing line, not just its number. History outlives both logs, and an
  # exit code on its own cannot be read six hours later.
  WHY=$(grep -a 'STOPPED:' "$LOG" | tail -1 | sed 's/.*STOPPED: //')
  record "FAILED $WANT — exit $status${WHY:+ — $WHY}; running ${RUNNING:-unknown}"
  exit "$status"
fi
