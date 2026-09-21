import { describe, expect, test } from 'bun:test';
import { contextReading, contextWindow, formatTokens } from './context-window';

const turn = (input: number, model?: string, costUsd: number | null = null) => ({
  usage: { input, costUsd, ...(model === undefined ? {} : { model }) },
});

describe('contextWindow', () => {
  test('a specific id beats the family it belongs to', () => {
    expect(contextWindow('claude-sonnet-4-5-20250929')).toBe(200_000);
    expect(contextWindow('gpt-5.5')).toBe(400_000);
  });

  test('an unknown model has no window — never a default', () => {
    // A default here would be a guess wearing a number's clothes, and it would
    // be used to decide when to abandon a conversation.
    expect(contextWindow('some-new-model')).toBeNull();
    expect(contextWindow(null)).toBeNull();
    expect(contextWindow('')).toBeNull();
  });
});

describe('contextReading', () => {
  test('occupancy is the NEWEST turn, never the sum', () => {
    const r = contextReading([turn(50_000, 'claude-opus'), turn(90_000, 'claude-opus')]);
    expect(r?.tokens).toBe(90_000);
  });

  test('a drop is reported as a drop — that is compaction becoming visible', () => {
    const r = contextReading([turn(180_000, 'claude-opus'), turn(30_000, 'claude-opus')]);
    expect(r?.tokens).toBe(30_000);
    expect(r?.fraction).toBeCloseTo(0.15);
  });

  test('cost IS cumulative — every turn was paid for separately', () => {
    const r = contextReading([turn(10, 'claude-opus', 0.25), turn(20, 'claude-opus', 0.75)]);
    expect(r?.costUsd).toBeCloseTo(1.0);
  });

  test('an unknown model yields tokens but no fraction', () => {
    const r = contextReading([turn(90_000, 'mystery-model')]);
    expect(r?.tokens).toBe(90_000);
    expect(r?.fraction).toBeNull();
  });

  test('turns that reported nothing are skipped, not counted as zero', () => {
    expect(contextReading([{ usage: null }, { usage: null }])).toBeNull();
    const r = contextReading([turn(1_000, 'claude-opus'), { usage: null }]);
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
