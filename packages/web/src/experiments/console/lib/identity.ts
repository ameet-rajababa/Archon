/**
 * An identity — a color and a glyph — and the rules for resolving one.
 *
 * Two things wear identities now: a project (rail row, stored per project id)
 * and an assistant (the mark on an agent message, stored per provider id).
 * The vocabulary and the resolution rules are the same for both, so they live
 * here and each subject owns only its own storage.
 *
 * `seed` is whatever string identifies the subject. It decides the fallback
 * color and glyph, so an unconfigured subject still reads as itself rather
 * than as a hole.
 */
import { isHexColor } from './color-hsv';
import { tileColor } from './icon-color';

/** Ten presets, matching the picker's top row. Names are kept because a swatch alone is not accessible. */
export const IDENTITY_COLORS: readonly { key: string; value: string }[] = [
  { key: 'grey', value: 'oklch(0.72 0.02 265)' },
  { key: 'slate', value: 'oklch(0.66 0.04 250)' },
  { key: 'indigo', value: 'oklch(0.58 0.17 275)' },
  { key: 'cyan', value: 'oklch(0.70 0.12 215)' },
  { key: 'green', value: 'oklch(0.70 0.14 160)' },
  { key: 'yellow', value: 'oklch(0.80 0.14 92)' },
  { key: 'orange', value: 'oklch(0.70 0.15 55)' },
  { key: 'pink', value: 'oklch(0.75 0.11 5)' },
  { key: 'red', value: 'oklch(0.64 0.19 25)' },
  { key: 'plum', value: 'oklch(0.58 0.14 325)' },
];

export interface Identity {
  /**
   * A key from IDENTITY_COLORS, a literal `#rrggbb` from the custom picker, or
   * null to use the seed-derived default. Two spellings of one field rather
   * than two fields: every reader goes through `resolveIdentityColor`, and a
   * subject has exactly one color however it was chosen.
   */
  color: string | null;
  /** A glyph name the picker offers, an emoji character, or null for the default. */
  glyph: string | null;
}

/** Nothing chosen. A subject with no stored identity reads as this. */
export const UNSET: Identity = { color: null, glyph: null };

/**
 * The color to actually paint, resolving a chosen key to its value and falling
 * back to the seed-derived default. Never returns null, so a row always has a
 * color and the rail never renders a hole.
 */
export function resolveIdentityColor(seed: string, identity: Identity): string {
  const chosen = identity.color;
  if (chosen !== null) {
    if (isHexColor(chosen)) return chosen;
    const hit = IDENTITY_COLORS.find(c => c.key === chosen);
    if (hit !== undefined) return hit.value;
  }
  // The default spreads across the identity palette rather than reusing
  // `tileColor`, whose hues are deliberately concentrated in the warm end.
  // That is correct for a tinted monogram tile and wrong for a bare glyph:
  // six warm glyphs down a rail read as one color repeated.
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 33 + seed.charCodeAt(i)) >>> 0;
  // Skip `grey` — a subject that chose grey means it; one that was assigned it
  // looks unconfigured.
  const pool = IDENTITY_COLORS.slice(1);
  return pool[h % pool.length]?.value ?? tileColor(seed);
}
