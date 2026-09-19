#!/usr/bin/env bash
# Mockups live in /home/appuser/mockups (host bind mount, survives dist swaps).
# dist/assets is replaced wholesale on every deploy, which both deletes the
# mockups and changes the hashed CSS filename they link to. Rewrite the href
# to whatever the current bundle is, or the page renders with no design
# tokens and looks blank.
set -euo pipefail
DIST=/app/packages/web/dist/assets
CSS=$(basename "$(ls "$DIST"/index-*.css | head -1)")
for f in /home/appuser/mockups/*.html; do
  [ -e "$f" ] || continue
  sed -E "s|/assets/index-[A-Za-z0-9_-]+\.css|/assets/$CSS|g" "$f" > "$DIST/$(basename "$f")"
  echo "restored $(basename "$f") -> $CSS"
done

# Images have no stylesheet to repoint — they just need putting back.
for f in /home/appuser/mockups/*.png /home/appuser/mockups/*.svg; do
  [ -e "$f" ] || continue
  cp "$f" "$DIST/$(basename "$f")"
  echo "restored $(basename "$f")"
done
