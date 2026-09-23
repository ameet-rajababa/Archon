import { describe, test, expect } from 'bun:test';
import { looksLikeRowId } from './codebases';

describe('looksLikeRowId', () => {
  test('a uuid is a possible row id', () => {
    expect(looksLikeRowId('39dcbf27-dde4-4308-80c5-c9f9ebd3b67b')).toBe(true);
    expect(looksLikeRowId('39DCBF27-DDE4-4308-80C5-C9F9EBD3B67B')).toBe(true);
  });

  // SQLite writes the same 128 bits without dashes — `lower(hex(randomblob(16)))`
  // is the column default on every id column in that schema. Rejecting this shape
  // rejects every row the default backend has ever created.
  test('a dash-less SQLite id is a possible row id', () => {
    expect(looksLikeRowId('6d8cfb5f27a78555c200e2d385babe82')).toBe(true);
    expect(looksLikeRowId('6D8CFB5F27A78555C200E2D385BABE82')).toBe(true);
  });

  // A project NAME in a URL where an id belonged is how this was found: five
  // console endpoints answered 500 because the driver rejected the comparison.
  test('a name is not, so it can be answered with "no such row"', () => {
    expect(looksLikeRowId('archon')).toBe(false);
    expect(looksLikeRowId('')).toBe(false);
    expect(looksLikeRowId('39dcbf27-dde4-4308-80c5')).toBe(false);
    // 31 and 33 hex: near-misses for the dash-less shape.
    expect(looksLikeRowId('6d8cfb5f27a78555c200e2d385babe8')).toBe(false);
    expect(looksLikeRowId('6d8cfb5f27a78555c200e2d385babe821')).toBe(false);
    expect(looksLikeRowId('../../etc/passwd')).toBe(false);
  });
});
