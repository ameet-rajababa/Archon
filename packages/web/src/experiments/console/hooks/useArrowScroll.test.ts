import { describe, test, expect } from 'bun:test';
import { arrowScrollDelta, ARROW_SCROLL_PX, type FocusedElement } from './useArrowScroll';

function press(key: string, over: Partial<Parameters<typeof arrowScrollDelta>[0]> = {}) {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    ...over,
  };
}

const composer: FocusedElement = { tagName: 'TEXTAREA', isContentEditable: false, value: '' };

describe('arrowScrollDelta', () => {
  test('arrows scroll when nothing holds focus', () => {
    expect(arrowScrollDelta(press('ArrowDown'), null)).toBe(ARROW_SCROLL_PX);
    expect(arrowScrollDelta(press('ArrowUp'), null)).toBe(-ARROW_SCROLL_PX);
  });

  test('an empty composer does not claim the key', () => {
    expect(arrowScrollDelta(press('ArrowDown'), composer)).toBe(ARROW_SCROLL_PX);
  });

  test('a composer holding a draft keeps the key for its caret', () => {
    expect(arrowScrollDelta(press('ArrowUp'), { ...composer, value: 'half a message' })).toBe(null);
  });

  test('single-line inputs and rich editors keep the key', () => {
    expect(
      arrowScrollDelta(press('ArrowUp'), { tagName: 'INPUT', isContentEditable: false, value: '' })
    ).toBe(null);
    expect(
      arrowScrollDelta(press('ArrowUp'), { tagName: 'SELECT', isContentEditable: false })
    ).toBe(null);
    expect(arrowScrollDelta(press('ArrowUp'), { tagName: 'DIV', isContentEditable: true })).toBe(
      null
    );
  });

  test('a focusable card inside the transcript still scrolls', () => {
    expect(arrowScrollDelta(press('ArrowDown'), { tagName: 'DIV', isContentEditable: false })).toBe(
      ARROW_SCROLL_PX
    );
  });

  test('ignores other keys, modifier combos and keys already handled', () => {
    expect(arrowScrollDelta(press('ArrowLeft'), null)).toBe(null);
    expect(arrowScrollDelta(press('j'), null)).toBe(null);
    expect(arrowScrollDelta(press('ArrowDown', { metaKey: true }), null)).toBe(null);
    expect(arrowScrollDelta(press('ArrowDown', { shiftKey: true }), null)).toBe(null);
    expect(arrowScrollDelta(press('ArrowDown', { defaultPrevented: true }), null)).toBe(null);
  });

  test('honours a caller-supplied step', () => {
    expect(arrowScrollDelta(press('ArrowDown'), null, 10)).toBe(10);
    expect(arrowScrollDelta(press('ArrowUp'), null, 10)).toBe(-10);
  });
});
