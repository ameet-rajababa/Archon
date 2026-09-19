#!/usr/bin/env bash
# Build the console from the accumulated live branch and swap it into the
# running container — but only if every shipped feature is still in the bundle.
#
# WHY: deploys are built from local/deploy, which carries every feature
# cherry-picked together. Building from a single upstream branch instead ships a
# bundle missing everything else, which is exactly how follow-tail, sticky tabs,
# drag-drop, chips and line-breaks were all silently dropped on 2026-09-18.
#
# The branch was once called local/live-drag-drop. That name still exists as a
# stale branch, and on 2026-09-19 a deploy built from it reverted fourteen
# commits while passing every marker. Hence the lineage check below.
set -euo pipefail

REPO=/home/appuser/archon-upstream
WEB=/app/packages/web
BRANCH=local/deploy

# How far Cole's dev has moved since we last took it. Reported on every deploy
# rather than on a schedule: this container has no cron daemon, and a drift
# number nobody sees is the same as not measuring it.
if git -C "$REPO" fetch -q origin dev 2>/dev/null; then
  behind=$(git -C "$REPO" rev-list --count "$BRANCH..origin/dev" 2>/dev/null || echo '?')
  if [ "$behind" != "0" ] && [ "$behind" != "?" ]; then
    echo "NOTE: origin/dev is $behind commits ahead. Pull it with: /home/appuser/sync-upstream.sh"
  fi
fi

# Markers: one distinctive string per shipped feature. Add a line when a feature ships.
MARKERS=(
  "Drop files to attach"                      # drag + paste to attach
  "flex-wrap justify-end"                     # file chips on sent messages
  "deleted from the server once it was read"  # attachment retention tooltip
  "archon.console.projectView"                # sticky Runs/Chat tabs
  "Jump to bottom"                            # follow tail
  "Filter chats"                              # chat rail
  "Press ⌘C"                                  # copy button on code blocks
  "Leave empty if it does not apply"          # three-part summary modal
  "Read the summary"                          # summary opens in a modal
  "archon.console.chatOrder."                 # drag-sort chats by hand
  "brand-blue"                                # distinct blue chat-label color
)

on=$(git -C "$REPO" rev-parse --abbrev-ref HEAD)
[ "$on" = "$BRANCH" ] || { echo "REFUSING: on '$on', deploys must build from '$BRANCH'"; exit 1; }

# Lineage: refuse when another local/* deploy branch holds work this one lacks.
# Markers cannot catch that class — a stale build passes every marker naming an
# older feature, and a behavioural fix never gets a marker at all.
# git cherry, not merge-base: everything here is cherry-picked so SHAs never
# match. It compares patch-ids and prints '-' when an equivalent change is
# already present, '+' when it is genuinely missing.
lineage_behind=0
for other in $(git -C "$REPO" branch --format='%(refname:short)' | grep -E '^local/' || true); do
  [ "$other" = "$BRANCH" ] && continue
  gone=$(git -C "$REPO" cherry "$BRANCH" "$other" | grep '^+' || true)
  if [ -z "$gone" ]; then
    printf '  ok      %s fully contained\n' "$other"
  else
    printf '  BEHIND  %s holds %s commit(s) missing from %s:\n' \
      "$other" "$(printf '%s\n' "$gone" | wc -l | tr -d ' ')" "$BRANCH"
    printf '%s\n' "$gone" | while read -r _ sha; do
      printf '            %s\n' "$(git -C "$REPO" log --oneline -1 "$sha")"
    done
    lineage_behind=1
  fi
done
[ "$lineage_behind" -eq 0 ] || {
  echo "REFUSING TO DEPLOY: $BRANCH is behind another deploy branch — reconcile first"
  exit 1
}

( cd "$REPO/packages/web" && bun run build >/dev/null )

js=$(ls "$REPO/packages/web/dist/assets/"index-*.js | head -1)
missing=0
for m in "${MARKERS[@]}"; do
  if grep -qF "$m" "$js"; then printf '  ok      %s\n' "$m"
  else printf '  MISSING %s\n' "$m"; missing=1; fi
done
[ "$missing" -eq 0 ] || { echo "REFUSING TO DEPLOY: the bundle is missing shipped features"; exit 1; }

rm -rf "$WEB/dist.staged" "$WEB/dist.prev"
cp -a "$REPO/packages/web/dist" "$WEB/dist.staged"
mv "$WEB/dist" "$WEB/dist.prev"; mv "$WEB/dist.staged" "$WEB/dist"; rm -rf "$WEB/dist.prev"

# dist/assets is replaced wholesale above, taking the mockups with it and
# invalidating the hashed CSS they link to. Put them back against the new hash.
[ -x /home/appuser/restore-mockups.sh ] && /home/appuser/restore-mockups.sh

# Back up exactly what is now live. The integrated branch lives on one machine
# and a container recreate has wiped this box before; the fork branch is the
# only other copy. Pushing here, rather than on commit, means `console` always
# names a build that actually deployed.
#
# The lease names the sha it is leasing against. A bare --force-with-lease reads
# the remote-tracking ref, and pushing to a URL creates none — so the lease is
# against nothing and the server rejects every real update as 'stale info'. That
# is not theoretical: it failed on 2026-09-19 and on every deploy before it that
# had anything to back up, because a no-op push is the only case the bare form
# lets through. The warning was printed each time and read as a fluke.
FORK_URL=https://github.com/ameet-rajababa/Archon.git
live_sha=$(git -C "$REPO" rev-parse "$BRANCH")

# gh's helper first: the PAT embedded in the `fork` remote is expired, and
# GH_TOKEN is not exported into every shell this runs from.
if gh auth status >/dev/null 2>&1; then
  auth=(-c "credential.helper=!gh auth git-credential")
  url=$FORK_URL
elif [ -n "${GH_TOKEN:-}" ]; then
  auth=()
  url="https://x-access-token:${GH_TOKEN}@github.com/ameet-rajababa/Archon.git"
else
  auth=()
  url=
fi

# Never print a URL back: it may carry the token.
scrub() { sed -E 's#https://[^@ ]*@#https://***@#g; s#gh[pousr]_[A-Za-z0-9]+#***#g'; }
# Only for reading back what landed. An empty answer here means "not backed up",
# which is the right reading whether the ref is missing or the fork went away.
fork_console() {
  (git -C "$REPO" "${auth[@]}" ls-remote "$url" refs/heads/console 2>/dev/null | cut -f1) || true
}

if [ -z "$url" ]; then
  echo "WARNING: no GitHub credential (gh not logged in, GH_TOKEN unset) — skipping the fork backup"
elif ! remote_heads=$(git -C "$REPO" "${auth[@]}" ls-remote --heads "$url" 2>&1); then
  # Unreachable is not the same as "console does not exist yet", and guessing
  # wrong the optimistic way means a blind force push over an unread fork.
  echo "WARNING: could not reach the fork — the deploy is live but unbacked"
  printf '%s\n' "$remote_heads" | scrub | sed 's/^/  /'
else
  before_sha=$(printf '%s\n' "$remote_heads" | awk '$2 == "refs/heads/console" { print $1 }')
  gone=
  lease=()
  if [ -n "$before_sha" ]; then
    # What the fork holds has to be compared, not assumed. A lease against a sha
    # read a moment ago cannot tell you the fork carries work you lack — it
    # agrees by construction, which makes it a plain force push wearing a safer
    # name. So the content check is separate, and it is the same one the lineage
    # check above uses: git cherry, not merge-base, because everything here is
    # cherry-picked and the shas never match.
    if git -C "$REPO" "${auth[@]}" fetch -q "$url" \
         "console:refs/deploy-backup/console" --force 2>/dev/null; then
      gone=$(git -C "$REPO" cherry "$BRANCH" refs/deploy-backup/console | grep '^+' || true)
    else
      gone="? could not read fork/console to compare against"
    fi
    # Now the lease means something: it guards the window between that read and
    # the push, so a push from elsewhere in between is rejected rather than lost.
    lease=(--force-with-lease="console:$before_sha")
  fi

  if [ -n "$gone" ]; then
    echo "WARNING: refusing to back up — fork/console holds work this deploy does not:"
    printf '%s\n' "$gone" | while read -r _ sha; do
      [ -n "${sha:-}" ] || { echo "            $_"; continue; }
      printf '            %s\n' "$(git -C "$REPO" log --oneline -1 "$sha" 2>/dev/null || echo "$sha")"
    done
    echo "  the deploy is live but unbacked; reconcile the fork before the next deploy"
  else
    push_out=$(git -C "$REPO" "${auth[@]}" push "$url" "$BRANCH:console" "${lease[@]}" 2>&1) || true
    # Judge the backup by what the fork now holds, not by the push's exit code —
    # the same reason the bundle is checked in what is served rather than in what
    # was built. A warning nobody could act on is how this stayed broken.
    if [ "$(fork_console)" = "$live_sha" ]; then
      echo "backed up: $BRANCH -> fork/console ($(git -C "$REPO" rev-parse --short "$BRANCH"))"
    else
      echo "WARNING: could not back up to fork/console — the deploy is live but unbacked"
      printf '%s\n' "$push_out" | scrub | sed 's/^/  /'
      [ -z "$before_sha" ] || echo "  fork/console is at ${before_sha:0:8}, this deploy is ${live_sha:0:8}"
    fi
  fi
fi

served=$(curl -sS http://localhost:3000/ | grep -oE 'assets/index-[^"]+\.js' | head -1)
echo "deployed and serving: $served"

# Layout smoke test in a real browser. Type-check, lint and unit tests cannot
# see a page that scrolls when it should not — that has now shipped twice.
SMOKE=/home/appuser/.tools/pw/smoke.mjs
CHAT="http://localhost:3000/console/p/ab932971-eae1-46df-b466-b060990645ce/chat"
if [ -f "$SMOKE" ]; then
  echo "--- layout smoke ---"
  bun "$SMOKE" "$CHAT" "main section" || echo "WARNING: the chat page scrolls the document — roll back or fix before relying on this build"
fi
