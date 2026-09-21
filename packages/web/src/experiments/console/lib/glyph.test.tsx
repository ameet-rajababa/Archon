import { describe, expect, test } from 'bun:test';
import { ICON_NAMES, EMOJI } from './glyph-data';
import { defaultGlyph, isEmojiGlyph } from './glyph';

/**
 * `isEmojiGlyph` decides two things that have to agree: whether `Glyph` tints,
 * and whether the picker offers a color at all. Both vocabularies are checked
 * whole, because the predicate is "not an icon name" — anything the icon table
 * loses would silently become an emoji.
 */
describe('isEmojiGlyph', () => {
  test('every icon the picker offers is tintable', () => {
    for (const name of ICON_NAMES) expect(isEmojiGlyph(name)).toBe(false);
  });
  test('every emoji the picker offers is not', () => {
    for (const emoji of EMOJI) expect(isEmojiGlyph(emoji)).toBe(true);
  });
  test('an unchosen glyph is tintable — it renders as the deterministic icon', () => {
    expect(isEmojiGlyph(null)).toBe(false);
    expect(isEmojiGlyph('')).toBe(false);
    expect(ICON_NAMES).toContain(defaultGlyph('any-project-id'));
  });
});
