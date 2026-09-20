import type { ReactElement } from 'react';
import { ICON_NAMES, ICON_PATHS } from './glyph-data';

/**
 * A project's glyph.
 *
 * Renders from the same path data the picker offers, so anything choosable is
 * renderable — the earlier version drew from a curated set of 35 component
 * imports while the picker offered 245, which meant most choices fell back to
 * a default.
 *
 * An emoji is stored as the character itself, which is not an icon name, so it
 * renders as text.
 */
export function ProjectGlyph({
  projectId,
  glyph,
  color,
  size = 15,
}: {
  projectId: string;
  glyph: string | null;
  color: string;
  size?: number;
}): ReactElement {
  const name = glyph !== null && glyph in ICON_PATHS ? glyph : null;

  // Chosen an emoji: it carries its own colour and is not tinted.
  if (name === null && glyph !== null && glyph !== '') {
    return (
      <span aria-hidden style={{ fontSize: size + 1, lineHeight: `${String(size + 2)}px` }}>
        {glyph}
      </span>
    );
  }

  const key = name ?? defaultGlyph(projectId);
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
 * A stable glyph for a project that has not chosen one.
 *
 * Same idea as the deterministic colour: every project reads as distinct
 * before anyone configures anything, and it never changes underneath you.
 */
export function defaultGlyph(projectId: string): string {
  let h = 0;
  for (let i = 0; i < projectId.length; i++) h = (h * 31 + projectId.charCodeAt(i)) >>> 0;
  return ICON_NAMES[h % ICON_NAMES.length] ?? 'hexagon';
}
