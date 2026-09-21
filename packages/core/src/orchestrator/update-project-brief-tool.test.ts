import { describe, expect, test } from 'bun:test';
import { mergeBrief, sameText, isBlank, type Brief } from './update-project-brief-tool';

const NOW = 1_700_000_000_000;
const b = (p: Partial<Brief> = {}): Brief => ({
  why: 'w',
  doing: 'd',
  where: 'r',
  updatedAt: 1,
  ...p,
});

describe('mergeBrief', () => {
  test('an omitted field keeps its value', () => {
    const out = mergeBrief(b(), { doing: 'new doing' }, NOW);
    expect(out).toEqual({ why: 'w', doing: 'new doing', where: 'r', updatedAt: NOW });
  });

  test('identical text leaves updatedAt alone', () => {
    // The whole point. The card says "written 4m ago", and that is the only
    // thing stopping a stale brief being believed — an agent that rewrites the
    // same words must not be able to make it look fresh.
    const out = mergeBrief(b({ updatedAt: 42 }), { why: 'w', doing: 'd', where: 'r' }, NOW);
    expect(out.updatedAt).toBe(42);
  });

  test('whitespace-only difference is not a change', () => {
    const out = mergeBrief(b({ updatedAt: 42 }), { doing: '  d  ' }, NOW);
    expect(out.updatedAt).toBe(42);
  });

  test('a real change stamps the time', () => {
    expect(mergeBrief(b({ updatedAt: 42 }), { where: 'moved on' }, NOW).updatedAt).toBe(NOW);
  });

  test('a non-string field is ignored rather than coerced', () => {
    // An agent passing a number must not blank the field or write "42".
    const out = mergeBrief(b(), { doing: 42 }, NOW);
    expect(out.doing).toBe('d');
    expect(out.updatedAt).toBe(1);
  });

  test('writing the first brief stamps it', () => {
    const empty: Brief = { why: '', doing: '', where: '', updatedAt: null };
    const out = mergeBrief(empty, { why: 'because' }, NOW);
    expect(out).toEqual({ why: 'because', doing: '', where: '', updatedAt: NOW });
  });
});

describe('isBlank', () => {
  test('all three empty is blank', () => {
    expect(isBlank({ why: '', doing: '', where: '', updatedAt: null })).toBe(true);
  });
  test('one field is enough to be worth storing', () => {
    expect(isBlank({ why: '', doing: 'x', where: '', updatedAt: null })).toBe(false);
  });
});

describe('sameText', () => {
  test('ignores the timestamp', () => {
    expect(sameText(b({ updatedAt: 1 }), b({ updatedAt: 999 }))).toBe(true);
  });
});
