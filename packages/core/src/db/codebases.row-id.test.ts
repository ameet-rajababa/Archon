import { describe, test, expect } from 'bun:test';
import { looksLikeRowId } from './codebases';

describe('looksLikeRowId', () => {
  test('a uuid is a possible row id', () => {
    expect(looksLikeRowId('39dcbf27-dde4-4308-80c5-c9f9ebd3b67b')).toBe(true);
    expect(looksLikeRowId('39DCBF27-DDE4-4308-80C5-C9F9EBD3B67B')).toBe(true);
  });

  // A project NAME in a URL where an id belonged is how this was found: five
  // console endpoints answered 500 because the driver rejected the comparison.
  test('a name is not, so it can be answered with "no such row"', () => {
    expect(looksLikeRowId('archon')).toBe(false);
    expect(looksLikeRowId('')).toBe(false);
    expect(looksLikeRowId('39dcbf27-dde4-4308-80c5')).toBe(false);
    expect(looksLikeRowId('../../etc/passwd')).toBe(false);
  });
});
