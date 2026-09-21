import { describe, expect, test } from 'bun:test';
import { contextReading, formatTokens } from './context-window';

const turn = (input: number, window?: number, costUsd: number | null = null) => ({
  usage: { input, costUsd, ...(window === undefined ? {} : { window }) },
});

describe('contextReading', () => {
  test('occupancy is the NEWEST turn, never the sum', () => {
    const r = contextReading([turn(50_000, 200_000), turn(90_000, 200_000)]);
    expect(r?.tokens).toBe(90_000);
  });

  test('a drop is reported as a drop — that is compaction becoming visible', () => {
    const r = contextReading([turn(180_000, 200_000), turn(30_000, 200_000)]);
    expect(r?.tokens).toBe(30_000);
    expect(r?.fraction).toBeCloseTo(0.15);
  });

  test('cost IS cumulative — every turn was paid for separately', () => {
    const r = contextReading([turn(10, 200_000, 0.25), turn(20, 200_000, 0.75)]);
    expect(r?.costUsd).toBeCloseTo(1.0);
  });

  test('no window from the server means no percentage is claimed', () => {
    // The table lives in core. Absent a window, this refuses to invent one
    // rather than falling back to a default that would be read as a fact.
    const r = contextReading([turn(90_000)]);
    expect(r?.tokens).toBe(90_000);
    expect(r?.fraction).toBeNull();
  });

  test('turns that reported nothing are skipped, not counted as zero', () => {
    expect(contextReading([{ usage: null }, { usage: null }])).toBeNull();
    const r = contextReading([turn(1_000, 200_000), { usage: null }]);
    expect(r?.tokens).toBe(1_000);
  });
});

describe('formatTokens', () => {
  test('reads at a glance', () => {
    expect(formatTokens(840)).toBe('840');
    expect(formatTokens(163_000)).toBe('163k');
    expect(formatTokens(1_200_000)).toBe('1.2M');
  });
});
