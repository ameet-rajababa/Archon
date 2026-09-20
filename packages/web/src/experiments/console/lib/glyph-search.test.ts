import { describe, expect, test } from 'bun:test';
import { searchEmoji, searchIcons } from './glyph-search';
import { EMOJI, ICON_NAMES } from './glyph-data';

describe('searchIcons', () => {
  test('an empty query is the whole set', () => {
    expect(searchIcons('').length).toBe(ICON_NAMES.length);
  });
  test('whole words and prefixes outrank an incidental substring', () => {
    const r = searchIcons('lock');
    expect(r[0]).toBe('lock');
    expect(r[1]).toBe('lock-open');
    // clock and blocks still match — they just come after
    expect(r).toContain('clock');
    expect(r.indexOf('clock')).toBeGreaterThan(r.indexOf('lock-open'));
  });
});

describe('searchEmoji', () => {
  test('an empty query is the whole set, in its curated order', () => {
    expect(searchEmoji('')).toEqual(EMOJI);
  });
  test('matches on keywords, because emoji have no names of their own', () => {
    expect(searchEmoji('lock')).toEqual(['🔐', '🔒', '🔓', '🔑', '🗝']);
    expect(searchEmoji('rocket')).toEqual(['🚀']);
    expect(searchEmoji('chart')).toEqual(['📊', '📈', '📉']);
  });
  test('a query that matches nothing returns nothing, not everything', () => {
    expect(searchEmoji('zzzznope')).toEqual([]);
  });
  test('the glyph itself is a query', () => {
    expect(searchEmoji('🚀')).toEqual(['🚀']);
  });
});
