import { describe, expect, test } from 'bun:test';
import { baselineUserIds, echoHasLanded } from './pending-echo';

const u = (id: string) => ({ id, role: 'user' });
const a = (id: string) => ({ id, role: 'assistant' });

describe('echoHasLanded', () => {
  test('stays up until the server row arrives', () => {
    const before = [u('1'), a('2')];
    const base = baselineUserIds(before);
    expect(echoHasLanded(before, base)).toBe(false);
    expect(echoHasLanded([...before, u('3')], base)).toBe(true);
  });

  test('a STALE baseline still retires the echo — the bug that shipped', () => {
    // The list really holds two user rows; the send captured a render where it
    // held three, which is what a counting rule could never recover from.
    const staleBaseline = baselineUserIds([u('1'), u('2'), u('3')]);
    const actual = [u('1'), u('2'), u('9')];
    expect(echoHasLanded(actual, staleBaseline)).toBe(true);
  });

  test('the same text twice retires its own echo, not the first one', () => {
    const base = baselineUserIds([u('1')]);
    // the second send's row is a different id even with identical content
    expect(echoHasLanded([u('1')], base)).toBe(false);
    expect(echoHasLanded([u('1'), u('2')], base)).toBe(true);
  });

  test('a new chat empties the list before the row lands', () => {
    const base = baselineUserIds([u('1'), u('2')]);
    expect(echoHasLanded([], base)).toBe(false);
    expect(echoHasLanded([u('7')], base)).toBe(true);
  });

  test('assistant rows never retire a user echo', () => {
    const base = baselineUserIds([u('1')]);
    expect(echoHasLanded([u('1'), a('2'), a('3')], base)).toBe(false);
  });
});
