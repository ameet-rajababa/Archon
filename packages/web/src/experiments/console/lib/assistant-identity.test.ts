import { describe, expect, test } from 'bun:test';
import { getAssistantIdentity } from './assistant-identity';
import { IDENTITY_COLORS, resolveIdentityColor } from './identity';
import { ICON_PATHS } from './glyph-data';

/**
 * The built-in marks are a hand-written table of names from two other
 * vocabularies — the picker's icon set and the preset colors. A typo in either
 * does not fail: it falls through to the deterministic default, which looks
 * like a design choice rather than a mistake. These tests are what makes the
 * table's claims checkable.
 *
 * Read through `getAssistantIdentity` rather than the table itself, so this
 * also covers the fallback chain a reader actually gets.
 */
const SHIPPED = ['claude', 'codex', 'pi', 'copilot', 'opencode'] as const;

describe('the shipped assistants', () => {
  test('each wears an icon the picker actually offers', () => {
    for (const assistant of SHIPPED) {
      const { glyph } = getAssistantIdentity(assistant);
      expect(glyph).not.toBeNull();
      expect(ICON_PATHS[glyph ?? '']).toBeString();
    }
  });

  test('each wears a color from the preset row', () => {
    const keys = IDENTITY_COLORS.map(c => c.key);
    for (const assistant of SHIPPED) {
      const { color } = getAssistantIdentity(assistant);
      expect(keys).toContain(color ?? '');
    }
  });

  test('no two of them look the same', () => {
    // The whole argument for a per-assistant mark is that it says WHICH agent
    // answered. Two assistants sharing an icon and a color says nothing.
    const marks = SHIPPED.map(a => {
      const id = getAssistantIdentity(a);
      return `${resolveIdentityColor(a, id)}/${id.glyph ?? ''}`;
    });
    expect(new Set(marks).size).toBe(SHIPPED.length);
  });
});

describe('an assistant with no built-in mark', () => {
  // A community provider added after this table was written. It must still
  // render something stable and distinct rather than a hole.
  test('falls back to a color and a glyph, deterministically', () => {
    const first = getAssistantIdentity('some-new-provider');
    const again = getAssistantIdentity('some-new-provider');
    expect(first).toEqual(again);
    expect(first.color).toBeNull();
    expect(first.glyph).toBeNull();

    const painted = resolveIdentityColor('some-new-provider', first);
    expect(painted).toBe(resolveIdentityColor('some-new-provider', again));
    expect(painted).toStartWith('oklch(');
  });

  test('gets its own color rather than everyone sharing one', () => {
    const colors = ['alpha', 'beta', 'gamma', 'delta'].map(a =>
      resolveIdentityColor(a, getAssistantIdentity(a))
    );
    expect(new Set(colors).size).toBeGreaterThan(1);
  });
});
