#!/usr/bin/env bash
# Build the console from the accumulated live branch and swap it into the
# running container — but only if every shipped feature is still in the bundle.
#
# WHY: deploys are built from local/live-drag-drop, which carries every feature
# cherry-picked together. Building from a single upstream branch instead ships a
# bundle missing everything else, which is exactly how follow-tail, sticky tabs,
# drag-drop, chips and line-breaks were all silently dropped on 2026-09-18.
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
)

on=$(git -C "$REPO" rev-parse --abbrev-ref HEAD)
[ "$on" = "$BRANCH" ] || { echo "REFUSING: on '$on', deploys must build from '$BRANCH'"; exit 1; }

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
if [ -n "${GH_TOKEN:-}" ]; then
  if git -C "$REPO" push -q "https://x-access-token:${GH_TOKEN}@github.com/ameet-rajababa/Archon.git" \
       "$BRANCH:console" --force-with-lease 2>/dev/null; then
    echo "backed up: $BRANCH -> fork/console ($(git -C "$REPO" rev-parse --short HEAD))"
  else
    echo "WARNING: could not back up to fork/console — the deploy is live but unbacked"
  fi
else
  echo "WARNING: GH_TOKEN unset, skipping the fork backup"
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
