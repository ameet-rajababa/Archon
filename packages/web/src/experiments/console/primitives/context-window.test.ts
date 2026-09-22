import { describe, expect, test } from 'bun:test';
import {
  contextReading,
  formatTokens,
  occupancyPercent,
  occupancyTone,
  shortModel,
} from './context-window';

const turn = (context: number, window?: number, costUsd: number | null = null) => ({
  usage: {
    context,
    // The turn TOTAL, deliberately absurd next to the window: a tool-heavy
    // turn really does sum to millions, and nothing may divide by it.
    input: context * 80,
    costUsd,
    model: 'claude-opus-5',
    ...(window === undefined ? {} : { window }),
  },
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

describe('the numerator is occupancy, never the turn total', () => {
  test('a tool-heavy turn does not report 6600% full', () => {
    const r = contextReading([turn(90_000, 200_000)]);
    expect(r?.tokens).toBe(90_000);
    expect(r?.fraction).toBeCloseTo(0.45);
  });

  test('a reading written before the distinction existed is skipped, not shown', () => {
    // `input` alone cannot be compared to a window, so it yields no reading
    // rather than a wrong one.
    expect(
      contextReading([{ usage: { input: 13_290_665, costUsd: null, window: 200_000 } }])
    ).toBeNull();
  });

  test('the denominator and the model come back for display', () => {
    const r = contextReading([turn(50_000, 200_000)]);
    expect(r?.window).toBe(200_000);
    expect(r?.model).toBe('claude-opus-5');
  });
});

describe('shortModel', () => {
  test('drops the vendor prefix and the build date, keeps the name', () => {
    expect(shortModel('claude-opus-5-20260101')).toBe('opus-5');
    expect(shortModel('claude-sonnet-4-5')).toBe('sonnet-4-5');
  });

  test('leaves a name that IS its family alone', () => {
    expect(shortModel('gpt-5.5')).toBe('gpt-5.5');
  });
});

describe('formatTokens', () => {
  test('reads at a glance', () => {
    expect(formatTokens(840)).toBe('840');
    expect(formatTokens(163_000)).toBe('163k');
    expect(formatTokens(1_200_000)).toBe('1.2M');
  });

  // `1.0M` spends a character to say nothing, and it is the window label most
  // often on screen. A decimal that carries information stays.
  test('drops a trailing .0 but keeps a decimal that means something', () => {
    expect(formatTokens(1_000_000)).toBe('1M');
    expect(formatTokens(2_000_000)).toBe('2M');
    expect(formatTokens(1_900_000)).toBe('1.9M');
  });
});

describe('occupancyTone', () => {
  test('grey below 40, amber to 60, red from 60', () => {
    expect(occupancyTone(0.39)).toBe('var(--text-tertiary)');
    expect(occupancyTone(0.4)).toBe('var(--warning-mark)');
    expect(occupancyTone(0.59)).toBe('var(--warning-mark)');
    expect(occupancyTone(0.6)).toBe('var(--error)');
    expect(occupancyTone(2.83)).toBe('var(--error)');
  });

  test('no window, no claim', () => {
    expect(occupancyTone(null)).toBe('var(--text-tertiary)');
  });
});

describe('occupancyPercent', () => {
  test('a whole number', () => {
    expect(occupancyPercent(0.774)).toBe(77);
    expect(occupancyPercent(0.5)).toBe(50);
  });

  // A cap would let a wrong denominator pass as merely full. This once read
  // 100% for a conversation at 283% of the window it had been given.
  test('never capped, because a capped number hides a broken one', () => {
    expect(occupancyPercent(2.835)).toBe(284);
  });
});
