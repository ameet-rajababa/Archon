import { describe, expect, test } from 'bun:test';
import { resolveChatsConfig } from './chats';

describe('resolveChatsConfig', () => {
  test('the defaults are about sharpness, not capacity', () => {
    const c = resolveChatsConfig(undefined);
    expect(c.nudgeAt).toBeCloseTo(0.4);
    expect(c.handoffAt).toBeCloseTo(0.5);
    expect(c.autoHandoff).toBe(true);
  });

  test('percentages become fractions', () => {
    const c = resolveChatsConfig({ nudgeAtPercent: 25, handoffAtPercent: 60 });
    expect(c.nudgeAt).toBeCloseTo(0.25);
    expect(c.handoffAt).toBeCloseTo(0.6);
  });

  test('a value that cannot be meant is refused, not honoured', () => {
    // 0 would hand off on the first turn; 100 could never fire. Both are
    // silently useless in a way nobody discovers for days.
    expect(resolveChatsConfig({ handoffAtPercent: 0 }).handoffAt).toBeCloseTo(0.5);
    expect(resolveChatsConfig({ handoffAtPercent: 100 }).handoffAt).toBeCloseTo(0.5);
    expect(resolveChatsConfig({ handoffAtPercent: Number.NaN }).handoffAt).toBeCloseTo(0.5);
  });

  test('a nudge above the handoff point is refused — it would announce what already happened', () => {
    const c = resolveChatsConfig({ nudgeAtPercent: 70, handoffAtPercent: 50 });
    expect(c.nudgeAt).toBeCloseTo(0.4);
    expect(c.handoffAt).toBeCloseTo(0.5);
  });

  test('automation can be turned off without losing the threshold', () => {
    const c = resolveChatsConfig({ handoffAtPercent: 45, autoHandoff: false });
    expect(c.handoffAt).toBeCloseTo(0.45);
    expect(c.autoHandoff).toBe(false);
  });
});
