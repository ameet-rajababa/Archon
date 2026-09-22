import { describe, expect, test } from 'bun:test';
import { bandFor, handoffAction, hasOpenAsk, nudgeMessage, shouldAnnounce } from './handoff-nudge';

describe('bandFor', () => {
  test('below the nudge level there is nothing to say', () => {
    expect(bandFor(0.2, 0.4, 0.5)).toBe('none');
  });

  test('the thresholds are inclusive — exactly 40% has crossed 40%', () => {
    expect(bandFor(0.4, 0.4, 0.5)).toBe('nudge');
    expect(bandFor(0.5, 0.4, 0.5)).toBe('handoff');
  });

  test('handoff wins over nudge — the more urgent half is the one to say', () => {
    expect(bandFor(0.9, 0.4, 0.5)).toBe('handoff');
  });

  test('configured thresholds are honoured, not the defaults', () => {
    expect(bandFor(0.3, 0.25, 0.35)).toBe('nudge');
    expect(bandFor(0.3, 0.4, 0.5)).toBe('none');
  });
});

describe('shouldAnnounce', () => {
  test('a band speaks once, not every turn past it', () => {
    // A reminder that repeats is a status bar with worse presentation, and the
    // reader stops seeing it.
    expect(shouldAnnounce('none', 'nudge')).toBe(true);
    expect(shouldAnnounce('nudge', 'nudge')).toBe(false);
  });

  test('the more urgent band still gets heard after the quieter one', () => {
    expect(shouldAnnounce('nudge', 'handoff')).toBe(true);
  });

  test('falling back does not speak, but does re-arm', () => {
    // Occupancy FALLS when the provider compacts. Dropping to 20% is not news;
    // climbing back through 40% afterwards is.
    expect(shouldAnnounce('handoff', 'nudge')).toBe(false);
    expect(shouldAnnounce('handoff', 'none')).toBe(false);
    expect(shouldAnnounce('none', 'handoff')).toBe(true);
  });
});

describe('nudgeMessage', () => {
  test('it says the number and what to do about it', () => {
    expect(nudgeMessage('nudge', 0.42)).toContain('42%');
    expect(nudgeMessage('nudge', 0.42)).toContain('hand off');
    expect(nudgeMessage('handoff', 0.63)).toContain('63%');
  });

  test('the urgent one asks for a decision, the quiet one does not', () => {
    expect(nudgeMessage('handoff', 0.6)).toContain('Time to hand off');
    expect(nudgeMessage('nudge', 0.45)).toContain('soon');
  });
});

// Backticks cannot live in a template literal, so fences are built from a
// constant and the fixtures are assembled line by line.
const F3 = '`'.repeat(3);
const F4 = '`'.repeat(4);
const doc = (...lines: string[]): string => lines.join('\n');

describe('hasOpenAsk', () => {
  test('a plain ask block is an open question', () => {
    expect(hasOpenAsk(doc('Pick one:', '', F3 + 'ask', '{"questions":[]}', F3, ''))).toBe(true);
  });

  test('prose and ordinary code blocks are not', () => {
    expect(hasOpenAsk('Just a sentence.')).toBe(false);
    expect(hasOpenAsk(doc(F3 + 'ts', 'const ask = 1;', F3))).toBe(false);
    expect(hasOpenAsk('')).toBe(false);
  });

  test('an ask fence DEMONSTRATED inside a longer fence is not a question', () => {
    // Every document that explains ask blocks contains one of these. Reading it
    // as a live question would block automatic handoff forever — which is the
    // whole reason this is a scanner and not a regex.
    expect(
      hasOpenAsk(
        doc(
          'Here is the format:',
          '',
          F4,
          F3 + 'ask',
          '{"questions":[]}',
          F3,
          F4,
          '',
          'That is all.'
        )
      )
    ).toBe(false);
  });

  test('an unterminated fence never became a block', () => {
    expect(hasOpenAsk(doc(F3 + 'ask', '{"questions":[]}'))).toBe(false);
  });

  test('a real ask AFTER a demonstration still counts', () => {
    expect(hasOpenAsk(doc(F4, F3 + 'ask', F4, '', F3 + 'ask', '{"questions":[]}', F3))).toBe(true);
  });
});

describe('handoffAction', () => {
  const base = { previous: 'none' as const, fraction: 0.6, autoHandoff: true, blocker: null };

  test('a band that has already spoken stays quiet', () => {
    expect(handoffAction({ ...base, band: 'handoff', previous: 'handoff' })).toEqual({
      kind: 'silent',
    });
    expect(handoffAction({ ...base, band: 'none' })).toEqual({ kind: 'silent' });
  });

  test('the nudge band only ever speaks, even with autoHandoff on', () => {
    expect(handoffAction({ ...base, band: 'nudge', fraction: 0.42 }).kind).toBe('announce');
  });

  test('autoHandoff off leaves the handoff band a suggestion', () => {
    expect(handoffAction({ ...base, band: 'handoff', autoHandoff: false })).toEqual({
      kind: 'announce',
      message: nudgeMessage('handoff', 0.6),
    });
  });

  test('autoHandoff on, nothing owed, acts', () => {
    expect(handoffAction({ ...base, band: 'handoff' })).toEqual({ kind: 'hand-off' });
  });

  test.each([
    ['awaiting-approval' as const, 'approval'],
    ['open-question' as const, 'open question'],
  ])('a blocked handoff says why rather than falling silent (%s)', (blocker, expected) => {
    const action = handoffAction({ ...base, band: 'handoff', blocker });
    expect(action.kind).toBe('announce');
    if (action.kind !== 'announce') throw new Error('unreachable');
    expect(action.message).toContain(expected);
    expect(action.message).toContain('60%');
  });
});
