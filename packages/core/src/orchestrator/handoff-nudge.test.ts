import { describe, expect, test } from 'bun:test';
import { bandFor, nudgeMessage, shouldAnnounce } from './handoff-nudge';

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
