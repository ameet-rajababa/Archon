#!/usr/bin/env bash
#
# Deploy this checkout to the local Docker install, verifying every step.
#
# Run on the HOST (it needs docker), not inside the container:
#
#   sudo bash /opt/archon/scripts/deploy-local.sh
#
# WHY THIS EXISTS. Deploying is six steps and each one can succeed while doing
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
set -euo pipefail

SOURCE_DIR="${SOURCE_DIR:-/home/appuser/archon-upstream}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/archon}"
SOURCE_BRANCH="${SOURCE_BRANCH:-local/deploy}"
REMOTE="${REMOTE:-fork}"
REMOTE_BRANCH="${REMOTE_BRANCH:-deploy}"
SERVICE="${SERVICE:-app}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health}"

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
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
step "1/6  Preflight"
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
step "2/6  Confirm $REMOTE/$REMOTE_BRANCH has $SHA"
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
step "3/6  Pull into $DEPLOY_DIR"
in_container "git -C '$DEPLOY_DIR' pull --ff-only '$REMOTE' '$REMOTE_BRANCH' 2>&1 | tail -2" \
  || die "pull failed — resolve it in $DEPLOY_DIR by hand"

DEPLOY_SHA=$(in_container "git -C '$DEPLOY_DIR' rev-parse HEAD" | tr -d '\r\n')
[ "$DEPLOY_SHA" = "$SHA" ] || die "build context is at $DEPLOY_SHA, expected $SHA — building it would ship the wrong commit"
echo "build context confirms: $DEPLOY_SHA"

# ── 4. Build ────────────────────────────────────────────────────────────────
# The SHA goes INTO the image so step 6 can ask what is running instead of
# inferring it from what was built.
step "4/6  Build"
docker compose build --build-arg "GIT_SHA=$SHA" "$SERVICE" || die "build failed"

# ── 5. Up ───────────────────────────────────────────────────────────────────
step "5/6  Restart and wait for health"
docker compose up -d "$SERVICE" || die "up failed"

for _ in $(seq 1 60); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "$HEALTH_URL" >/dev/null 2>&1 || die "never became healthy at $HEALTH_URL"
echo "healthy"

# ── 6. Ask the running container which commit it IS ─────────────────────────
# The one question worth asking. Everything above can be green while the
# container still runs an older image.
step "6/6  Verify what is actually running"
RUNNING_SHA=$(docker compose exec -T "$SERVICE" cat /app/.deployed-sha 2>/dev/null | tr -d '\r\n' || true)
[ -n "$RUNNING_SHA" ] || die "the running image carries no SHA — it predates this script; re-run now that the Dockerfile records one"
[ "$RUNNING_SHA" = "$SHA" ] || die "running $RUNNING_SHA, expected $SHA"

printf '\n\033[32mDeployed %s\033[0m\n' "$SHA"
in_container "git -C '$DEPLOY_DIR' log --oneline -1"
