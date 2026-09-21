import { describe, expect, test } from 'bun:test';
import {
  isStalled,
  normalSpanMs,
  stallThresholdMs,
  stalledIds,
  STALL_FALLBACK_MS,
  STALL_FLOOR_MS,
  STALL_CEILING_MS,
} from './stalled';
import type { Run } from './run';

const T0 = Date.parse('2026-09-21T00:00:00Z');
const min = (n: number): number => n * 60_000;

function run(p: Partial<Run> & { id: string }): Run {
  return {
    id: p.id,
    workflow: p.workflow ?? 'archon-deliver',
    status: p.status ?? 'completed',
    startedAt: p.startedAt ?? new Date(T0).toISOString(),
    finishedAt: p.finishedAt ?? null,
    lastActivityAt: p.lastActivityAt ?? null,
  } as Run;
}
const done = (id: string, spanMin: number, workflow = 'archon-deliver'): Run =>
  run({
    id,
    workflow,
    status: 'completed',
    startedAt: new Date(T0).toISOString(),
    finishedAt: new Date(T0 + min(spanMin)).toISOString(),
  });

describe('normalSpanMs', () => {
  test('is the median, so one zombie in the history cannot excuse the next', () => {
    // A mean over [20, 30, 40, 1380] is 367min; the median is 35.
    const runs = [done('a', 20), done('b', 30), done('c', 40), done('d', 1380)];
    expect(normalSpanMs(runs, 'archon-deliver')).toBe(min(35));
  });

  test('needs three samples before it claims to know', () => {
    expect(normalSpanMs([done('a', 20), done('b', 30)], 'archon-deliver')).toBeNull();
  });

  test('counts only the workflow asked about', () => {
    const runs = [done('a', 10), done('b', 10), done('c', 10), done('x', 900, 'archon-assist')];
    expect(normalSpanMs(runs, 'archon-deliver')).toBe(min(10));
  });

  test('ignores a run that finished before it started', () => {
    const bad = run({
      id: 'b',
      status: 'completed',
      startedAt: new Date(T0).toISOString(),
      finishedAt: new Date(T0 - min(5)).toISOString(),
    });
    expect(normalSpanMs([done('a', 10), done('c', 10), bad], 'archon-deliver')).toBeNull();
  });
});

describe('stallThresholdMs', () => {
  const hist = [done('a', 20), done('b', 20), done('c', 20)];

  test('is three normal spans', () => {
    expect(stallThresholdMs(hist, 'archon-deliver')).toBe(min(60));
  });

  test('never dips below the floor — a quick workflow is still allowed to think', () => {
    const quick = [done('a', 1), done('b', 1), done('c', 1)];
    expect(stallThresholdMs(quick, 'archon-deliver')).toBe(STALL_FLOOR_MS);
  });

  test('never exceeds the ceiling — no normal span excuses a whole day of silence', () => {
    const slow = [done('a', 600), done('b', 600), done('c', 600)];
    expect(stallThresholdMs(slow, 'archon-deliver')).toBe(STALL_CEILING_MS);
  });

  test('falls back generously when there is no history to learn from', () => {
    expect(stallThresholdMs([], 'brand-new-workflow')).toBe(STALL_FALLBACK_MS);
  });
});

describe('isStalled', () => {
  const hist = [done('a', 20), done('b', 20), done('c', 20)]; // threshold 60min

  test('the real case: running for 23h, silent for 23h', () => {
    const zombie = run({
      id: 'z',
      status: 'running',
      lastActivityAt: new Date(T0 - min(23 * 60)).toISOString(),
    });
    expect(isStalled(zombie, hist, T0)).toBe(true);
  });

  test('a long run that is still talking is NOT stalled', () => {
    const busy = run({
      id: 'w',
      status: 'running',
      lastActivityAt: new Date(T0 - min(5)).toISOString(),
    });
    expect(isStalled(busy, hist, T0)).toBe(false);
  });

  test('silence just under the threshold is still working', () => {
    const edge = run({
      id: 'e',
      status: 'running',
      lastActivityAt: new Date(T0 - min(59)).toISOString(),
    });
    expect(isStalled(edge, hist, T0)).toBe(false);
  });

  test('a run with no activity stamp is never called stalled', () => {
    // Absent evidence is not evidence. The point is to stop the UI asserting
    // things it cannot see.
    const blind = run({ id: 'b', status: 'running', lastActivityAt: null });
    expect(isStalled(blind, hist, T0)).toBe(false);
  });

  test('only `running` can stall — paused is a state someone chose', () => {
    const paused = run({
      id: 'p',
      status: 'paused',
      lastActivityAt: new Date(T0 - min(600)).toISOString(),
    });
    expect(isStalled(paused, hist, T0)).toBe(false);
  });
});

describe('stalledIds', () => {
  test('returns only the dead ones', () => {
    const hist = [done('a', 20), done('b', 20), done('c', 20)];
    const dead = run({
      id: 'dead',
      status: 'running',
      lastActivityAt: new Date(T0 - min(300)).toISOString(),
    });
    const live = run({
      id: 'live',
      status: 'running',
      lastActivityAt: new Date(T0 - min(2)).toISOString(),
    });
    expect([...stalledIds([...hist, dead, live], T0)]).toEqual(['dead']);
  });
});
