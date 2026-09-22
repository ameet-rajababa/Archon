import { describe, expect, it, beforeEach } from 'bun:test';
import { clampPaneWidth, readPaneWidth, writePaneWidth, type PaneBounds } from './pane-width';

const BOUNDS: PaneBounds = { key: 'test.pane.width', min: 200, max: 420, initial: 236 };

/**
 * The browser's store, as much of it as this module touches. Bun has no DOM,
 * and the two functions under test are precisely the ones that have to survive
 * a real store — a stub that only held values would prove nothing about the
 * out-of-bounds and unparseable cases, which are what they exist for.
 */
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string): string | null => store.get(k) ?? null,
  setItem: (k: string, v: string): void => {
    store.set(k, v);
  },
  removeItem: (k: string): void => {
    store.delete(k);
  },
  clear: (): void => {
    store.clear();
  },
};

describe('clampPaneWidth', () => {
  it('holds a width inside its bounds', () => {
    expect(clampPaneWidth(120, BOUNDS)).toBe(200);
    expect(clampPaneWidth(900, BOUNDS)).toBe(420);
    expect(clampPaneWidth(300, BOUNDS)).toBe(300);
  });

  it('keeps the bounds themselves', () => {
    expect(clampPaneWidth(200, BOUNDS)).toBe(200);
    expect(clampPaneWidth(420, BOUNDS)).toBe(420);
  });
});

describe('readPaneWidth', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns the default when nothing is stored', () => {
    expect(readPaneWidth(BOUNDS)).toBe(236);
  });

  it('returns a stored width inside the bounds', () => {
    writePaneWidth(BOUNDS, 312);
    expect(readPaneWidth(BOUNDS)).toBe(312);
  });

  it('discards an out-of-bounds width rather than clamping it', () => {
    // The bounds moved since it was written; the pane's current default is a
    // better answer than whichever edge the stale value lands on.
    localStorage.setItem(BOUNDS.key, '900');
    expect(readPaneWidth(BOUNDS)).toBe(236);
  });

  it('returns the default for a value that is not a width', () => {
    localStorage.setItem(BOUNDS.key, 'wide');
    expect(readPaneWidth(BOUNDS)).toBe(236);
  });
});
