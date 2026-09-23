#!/usr/bin/env bash
#
# Deploy this checkout to the local Docker install, verifying every step.
#
# Run on the HOST (it needs docker), not inside the container:
#
#   sudo bash /opt/archon/scripts/deploy-local.sh
#
# WHY THIS EXISTS. Deploying is seven steps and each one can succeed while doing
# nothing. In one evening: a push that was never run, a pull blocked by git's
# ownership guard, and two builds from a checkout that had not moved — every
# one reported success, and three of four deploys shipped the wrong commit
# without saying so.
#
# So the rule here is that no step is trusted to have worked. Each one is
# followed by a question whose answer comes from somewhere else: GitHub is
# asked for the SHA it now has, the deploy checkout is asked what its HEAD is,
# and the running container is asked which commit it was built from. A step
# whose effect cannot be confirmed stops the deploy.
#
# The layout it assumes, all overridable:
#   SOURCE_DIR   where the work happens — inside the container
#   DEPLOY_DIR   the docker build CONTEXT — a SEPARATE clone, on the host
#   The source is not bind-mounted into the image, which is why a rebuild is
#   required for server changes and a restart alone does nothing.
#
# WHAT IT WILL NOT DO. Recreating the container destroys whatever it is
# holding: a turn in flight, a message queued behind one, a workflow run that
# comes back as a `running` row nobody finishes. So step 5 waits for a moment
# when none of those exist. A chat that is merely open is not one of them — its
# provider session id is persisted, so it resumes with its context intact.
set -euo pipefail

SOURCE_DIR="${SOURCE_DIR:-/home/appuser/archon-upstream}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/archon}"
SOURCE_BRANCH="${SOURCE_BRANCH:-local/deploy}"
REMOTE="${REMOTE:-fork}"
REMOTE_BRANCH="${REMOTE_BRANCH:-deploy}"
SERVICE="${SERVICE:-app}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health}"
# The deadline of the systemd service that runs this deploy (TimeoutStartSec),
# so the wait in step 5 can be given a SLICE of it rather than a number that
# happens to be the same. Those two were both 1800s, and on 2026-09-23 a deploy
# spent 27m34s waiting for a turn-gap, swapped the container at 15:43:46, and
# was killed by systemd while the new image was still booting — the swap had
# happened, and no verdict was written anywhere.
DEPLOY_BUDGET_SECONDS="${DEPLOY_BUDGET_SECONDS:-1800}"
# What the swap needs AFTER the wait ends: `up -d`, a cold start answering the
# health check, and step 7. Held back from the wait rather than hoped for.
SWAP_RESERVE_SECONDS="${SWAP_RESERVE_SECONDS:-420}"
STARTED_AT=$(date -u +%s)

# Timestamped, because this log is the only post-mortem anyone gets and it
# could not answer "how long was it in step 5" — the difference between a build
# that dragged and a wait that never ended.
step() { printf '\n\033[1m── %s  [%s]\033[0m\n' "$1" "$(date -u '+%H:%M:%SZ')"; }
die() { printf '\n\033[31mSTOPPED: %s\033[0m\n' "$1" >&2; exit 1; }

# Everything container-side runs as root through one helper: the two checkouts
# are owned by different users and root is neither, so git's dubious-ownership
# guard fires on both. It is set here rather than asked of the operator because
# forgetting it is one of the ways a deploy silently did nothing.
in_container() {
  docker compose exec -T -u root "$SERVICE" sh -lc "git config --global --add safe.directory '*' >/dev/null 2>&1; $1"
}

cd "$DEPLOY_DIR" || die "no deploy directory at $DEPLOY_DIR"

# ── 1. Preflight ────────────────────────────────────────────────────────────
# What gets built is the COMMITTED SHA, so uncommitted work is a warning and
# not a failure. It was a failure for one evening, until the first run on this
# box stopped on sixteen files belonging to a different session: several agents
# share this checkout, so "clean" is a state it is never in, and a guard that
# can never pass is a guard that gets deleted or bypassed.
#
# The warning still earns its place — the trap is deploying and expecting an
# edit that was never committed to be in it.
#
# There is deliberately NO test step. Tests would have to run in the source
# checkout, which contains whatever every other session is mid-way through, so
# a red run would say nothing about the commit being shipped. A check that
# cannot be trusted is worse than no check; tests belong to the commit, and
# this script's honest job is proving that a specific SHA reached the
# container.
step "1/7  Preflight"
SHA=$(in_container "git -C '$SOURCE_DIR' rev-parse HEAD" | tr -d '\r\n')
[ -n "$SHA" ] || die "could not read the source HEAD"
echo "source HEAD: $SHA"

DIRTY_COUNT=$(in_container "git -C '$SOURCE_DIR' status --porcelain --untracked-files=no | wc -l" | tr -d ' \r\n')
if [ "${DIRTY_COUNT:-0}" != "0" ]; then
  printf '\033[33mnote: %s uncommitted file(s) in the source checkout — they will NOT be deployed\033[0m\n' "$DIRTY_COUNT"
fi

# ── 2. Ask GitHub what it has, and push only if it is behind ────────────────
# ASKED FIRST, pushed second. The requester pushes before it writes the request
# (see request-deploy.sh), because the container is the half that holds GitHub
# credentials — its token is injected per call by the env-var store and is not
# in the container's own environment, so a push issued from HERE, through
# `docker compose exec`, sees only whatever stale token the image was built
# with. That is what stopped two deploys: one on a token that had been rotated,
# one on no credential at all.
#
# Nothing is lost by asking first. The remote's own answer was always the
# evidence this step trusted — the push was only ever how the answer became
# true, and it is still attempted when the remote is genuinely behind, which is
# what a manual run of this script needs.
step "2/7  Confirm $REMOTE/$REMOTE_BRANCH has $SHA"
remote_sha() {
  in_container "cd '$SOURCE_DIR' && git ls-remote '$REMOTE' 'refs/heads/$REMOTE_BRANCH' | cut -f1" \
    | tr -d '\r\n'
}

REMOTE_SHA=$(remote_sha)
if [ "$REMOTE_SHA" != "$SHA" ]; then
  echo "remote is at ${REMOTE_SHA:-nothing} — pushing"
  in_container "cd '$SOURCE_DIR' && git push '$REMOTE' '$SOURCE_BRANCH:$REMOTE_BRANCH' 2>&1 | tail -2" \
    || die "remote is at ${REMOTE_SHA:-nothing} and the push failed — push from the source checkout, which has the credentials"
  REMOTE_SHA=$(remote_sha)
fi

[ "$REMOTE_SHA" = "$SHA" ] || die "remote is at ${REMOTE_SHA:-nothing}, expected $SHA"
echo "remote confirms: $REMOTE_SHA"

# ── 3. Pull into the build context, then assert it moved ────────────────────
# ON THE HOST, not through the container. $DEPLOY_DIR is the host's own build
# context — `docker compose build` reads it from here, two steps down — and it
# is visible to the container only through a bind mount declared in
# docker-compose.override.yml. Routing this git through that mount made the
# deploy depend on something that has nothing to do with it, and when a compose
# invocation carrying -f recreated the app container without the override, this
# step died on a directory the host could see the whole time. Three deploys
# failed here before the cause was the mount rather than the pull.
#
# Needs no credentials: the fork is public, and reading from it authenticates
# against nothing. The push is the half that needs a token, and it belongs to
# the container — see request-deploy.sh.
#
# safe.directory because the checkout is owned by neither root nor the invoking
# user, which is git's dubious-ownership guard and another way this has
# silently done nothing.
step "3/7  Pull into $DEPLOY_DIR"
command -v git >/dev/null 2>&1 \
  || die "the host has no git, and $DEPLOY_DIR is the host's build context"
git -c safe.directory='*' -C "$DEPLOY_DIR" pull --ff-only "$REMOTE" "$REMOTE_BRANCH" 2>&1 | tail -2 \
  || die "pull failed — resolve it in $DEPLOY_DIR by hand"

DEPLOY_SHA=$(git -c safe.directory='*' -C "$DEPLOY_DIR" rev-parse HEAD | tr -d '\r\n')
[ "$DEPLOY_SHA" = "$SHA" ] || die "build context is at $DEPLOY_SHA, expected $SHA — building it would ship the wrong commit"
echo "build context confirms: $DEPLOY_SHA"

# ── 4. Build ────────────────────────────────────────────────────────────────
# The SHA goes INTO the image so step 7 can ask what is running instead of
# inferring it from what was built.
#
# Built BEFORE the wait, deliberately. The build takes minutes and disturbs
# nothing; spending them after a quiet moment was found would spend the moment
# itself, and the box would be busy again by the time there was an image.
step "4/7  Build"
docker compose build --build-arg "GIT_SHA=$SHA" "$SERVICE" || die "build failed"

# ── 5. Wait for a moment when nothing is mid-flight ─────────────────────────
# Asked of the server that is ABOUT TO BE REPLACED, because it is the only
# thing that knows what it is holding. See scripts/turn-gap.ts for what counts
# as busy and why an unreadable answer is treated as busy.
#
# Run inside the container: bun is there, and so is the health endpoint. The
# script rides the source checkout, which deploy-on-request.sh has already
# confirmed is at the commit being shipped.
step "5/7  Wait for a turn-gap"
if [ "${SKIP_TURN_GAP:-0}" = "1" ]; then
  # The escape hatch, for a box wedged badly enough that waiting for it to go
  # quiet is waiting forever. It ends live turns. Announced rather than silent,
  # because the whole point of this step is that nobody reaches it by accident.
  printf '\033[33mSKIP_TURN_GAP=1 — swapping without waiting; work in flight WILL be lost\033[0m\n'
else
  # `|| gap_status=$?` and not a bare call: under `set -e` a non-zero exit here
  # would end the script before the case below could say which non-zero it was,
  # and "timed out" and "could not tell" need different words.
  # Whatever is left of the service's deadline once the build has taken what it
  # took, minus the reserve the swap needs. An explicit TURN_GAP_TIMEOUT still
  # wins: this derives a default, it does not override an operator.
  gap_budget=$((DEPLOY_BUDGET_SECONDS - ($(date -u +%s) - STARTED_AT) - SWAP_RESERVE_SECONDS))
  if [ "${TURN_GAP_TIMEOUT:-}" = "" ] && [ "$gap_budget" -le 0 ]; then
    die "the build left no room to swap inside the ${DEPLOY_BUDGET_SECONDS}s deploy budget — NOTHING was deployed, and it is still running what it was. Re-run, or raise DEPLOY_BUDGET_SECONDS and TimeoutStartSec together."
  fi
  gap_timeout="${TURN_GAP_TIMEOUT:-$gap_budget}"
  echo "waiting up to ${gap_timeout}s, holding ${SWAP_RESERVE_SECONDS}s back for the swap"

  gap_status=0
  in_container "cd '$SOURCE_DIR' && HEALTH_URL='$HEALTH_URL' TURN_GAP_TIMEOUT='$gap_timeout' TURN_GAP_INTERVAL='${TURN_GAP_INTERVAL:-}' TURN_GAP_CONFIRM='${TURN_GAP_CONFIRM:-}' bun scripts/turn-gap.ts" \
    || gap_status=$?
  case $gap_status in
    0) ;;
    1) die "the box never went quiet within ${gap_timeout}s — NOTHING was deployed, and it is still running what it was. Ask again later, or set SKIP_TURN_GAP=1 to swap anyway and lose the work in flight." ;;
    *) die "could not read what the container is holding, so it was left alone — NOTHING was deployed" ;;
  esac
fi

# ── 6. Up ───────────────────────────────────────────────────────────────────
step "6/7  Restart and wait for health"
docker compose up -d "$SERVICE" || die "up failed"

# The container is already swapped by this point, so a failure here is a
# failure with the new image LIVE. The message has to say so, or it reads as
# "nothing happened" — which is what the report said on 2026-09-23 while the
# new image was serving.
HEALTH_WAIT=${HEALTH_WAIT:-120}
waited=0
while [ "$waited" -lt "$HEALTH_WAIT" ]; do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then break; fi
  sleep 2
  waited=$((waited + 2))
done
curl -fsS "$HEALTH_URL" >/dev/null 2>&1 ||
  die "swapped to $SHA, but it never became healthy at $HEALTH_URL within ${HEALTH_WAIT}s — the new image IS running"
echo "healthy after ${waited}s"

# ── 7. Ask the running container which commit it IS ─────────────────────────
# The one question worth asking. Everything above can be green while the
# container still runs an older image.
step "7/7  Verify what is actually running"
RUNNING_SHA=$(docker compose exec -T "$SERVICE" cat /app/.deployed-sha 2>/dev/null | tr -d '\r\n' || true)
[ -n "$RUNNING_SHA" ] || die "the running image carries no SHA — it predates this script; re-run now that the Dockerfile records one"
[ "$RUNNING_SHA" = "$SHA" ] || die "running $RUNNING_SHA, expected $SHA"

printf '\n\033[32mDeployed %s\033[0m\n' "$SHA"
in_container "git -C '$DEPLOY_DIR' log --oneline -1"
