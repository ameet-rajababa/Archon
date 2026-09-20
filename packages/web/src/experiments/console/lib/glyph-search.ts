/**
 * Ranked search over the icon and emoji sets.
 *
 * Ranked, not just filtered. A bare substring test answers "lock" with
 * alarm-CLOCK and BLOCKs sitting among the padlocks, which is technically a
 * match and practically noise. Whole words and prefixes come first; an
 * incidental substring still appears, just last.
 *
 * Emoji carry no names of their own, so the emoji branch matches against the
 * index-aligned keyword list. Before that existed the search box accepted
 * typing and changed nothing — it looked live and filtered all 330 to 330.
 */
import { EMOJI, EMOJI_NAMES, ICON_NAMES } from './glyph-data';

function rank(text: string, term: string): number {
  if (text === term) return 0;
  const words = text.split(/[\s-]+/);
  if (words.includes(term)) return 1;
  if (text.startsWith(term)) return 2;
  if (words.some(w => w.startsWith(term))) return 3;
  return 4;
}

export function searchIcons(query: string): readonly string[] {
  const q = query.trim().toLowerCase();
  if (q === '') return ICON_NAMES;
  return ICON_NAMES.filter(k => k.includes(q))
    .map(k => ({ k, r: rank(k, q) }))
    .sort((a, b) => a.r - b.r)
    .map(o => o.k);
}

export function searchEmoji(query: string): readonly string[] {
  const q = query.trim().toLowerCase();
  if (q === '') return EMOJI;
  return EMOJI.map((k, i) => ({ k, n: EMOJI_NAMES[i] ?? '' }))
    .filter(o => o.k === q || o.n.includes(q))
    .map(o => ({ k: o.k, r: o.k === q ? 0 : rank(o.n, q) }))
    .sort((a, b) => a.r - b.r)
    .map(o => o.k);
}
