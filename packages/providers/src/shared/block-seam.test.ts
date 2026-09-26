import { describe, expect, test } from 'bun:test';
import { blockSeam } from './block-seam';

describe('blockSeam', () => {
  test('separates a closing fence from the heading that follows it', () => {
    const before = '```ask\n{"questions":[]}\n```';
    const after = '## Issue status';
    expect(before + blockSeam(before, after) + after).toBe(
      '```ask\n{"questions":[]}\n```\n\n## Issue status'
    );
  });

  test('leaves a seam that already ends in a newline alone', () => {
    expect(blockSeam('first\n', 'second')).toBe('');
  });

  test('leaves a seam that already starts with a newline alone', () => {
    expect(blockSeam('first', '\nsecond')).toBe('');
  });

  test('treats a trailing space as a deliberate run-on', () => {
    expect(blockSeam('hello ', 'world')).toBe('');
  });

  test('has nothing to join when either side is empty', () => {
    expect(blockSeam('', 'a')).toBe('');
    expect(blockSeam('a', '')).toBe('');
  });
});
