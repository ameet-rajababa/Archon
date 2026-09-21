import type { ReactElement } from 'react';
import { ICON_NAMES, ICON_PATHS } from './glyph-data';

/**
 * A subject's glyph — a project's, an assistant's.
 *
 * Renders from the same path data the picker offers, so anything choosable is
 * renderable — the earlier version drew from a curated set of 35 component
 * imports while the picker offered 245, which meant most choices fell back to
 * a default.
 *
 * An emoji is stored as the character itself, which is not an icon name, so it
 * renders as text.
 */
/**
 * True when the chosen glyph is an emoji rather than an icon name.
 *
 * The one place that decides it. `Glyph` uses it to skip the tint, and the
 * picker uses it to hide a color control that would paint nothing — two
 * answers that have to agree, so they come from the same function.
 */
export function isEmojiGlyph(glyph: string | null): boolean {
  return glyph !== null && glyph !== '' && !(glyph in ICON_PATHS);
}

export function Glyph({
  seed,
  glyph,
  color,
  size = 15,
}: {
  /** Identifies the subject, and decides its glyph when none was chosen. */
  seed: string;
  glyph: string | null;
  color: string;
  size?: number;
}): ReactElement {
  const name = glyph !== null && glyph in ICON_PATHS ? glyph : null;

  // Chosen an emoji: it carries its own color and is not tinted.
  if (isEmojiGlyph(glyph)) {
    return (
      <span aria-hidden style={{ fontSize: size + 1, lineHeight: `${String(size + 2)}px` }}>
        {glyph}
      </span>
    );
  }

  const key = name ?? defaultGlyph(seed);
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[key] ?? '' }}
    />
  );
}

/**
 * A stable glyph for a subject that has not chosen one.
 *
 * Same idea as the deterministic color: every project reads as distinct
 * before anyone configures anything, and it never changes underneath you.
 */
export function defaultGlyph(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return ICON_NAMES[h % ICON_NAMES.length] ?? 'hexagon';
}
