import { useEffect, type RefObject } from 'react';
import { modalIsOpen } from '../lib/keymap';

/**
 * Pixels one arrow press moves the transcript. Close to a browser's own
 * arrow-key step for a focused scroller, so held-down repeat feels native.
 */
export const ARROW_SCROLL_PX = 64;

/** The parts of a keyboard event this decision reads. */
export interface ArrowKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
}

/** Element-shaped view of whatever holds focus. A plain object satisfies it. */
export interface FocusedElement {
  tagName: string;
  isContentEditable: boolean;
  /** Present for form controls; a textarea's draft text. */
  value?: string;
}

/**
 * How far an arrow press should move the transcript, or null when the key
 * belongs to something else.
 *
 * The judgment that matters is the focus guard. The console's chat composer
 * re-focuses itself after every send, so the keymap's "not typing" rule —
 * any focused input keeps the key — would mean the arrows never scroll the
 * transcript in the one place a reader wants them to. An *empty* textarea has
 * no caret to move, so the key is free; a textarea holding a draft is being
 * edited and keeps it. Single-line inputs and contentEditable always keep it:
 * those are the rail filter and the summary editor, where a caret exists or
 * the surrounding component owns the key.
 */
export function arrowScrollDelta(
  event: ArrowKeyEvent,
  focused: FocusedElement | null,
  step: number = ARROW_SCROLL_PX
): number | null {
  if (event.defaultPrevented) return null;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return null;

  if (focused !== null) {
    if (focused.isContentEditable) return null;
    const tag = focused.tagName.toUpperCase();
    if (tag === 'INPUT' || tag === 'SELECT') return null;
    if (tag === 'TEXTAREA' && (focused.value ?? '').length > 0) return null;
  }

  return event.key === 'ArrowUp' ? -step : step;
}

/**
 * Makes ↑/↓ scroll a transcript that nothing has focused.
 *
 * A scrolling `<div>` is not keyboard-focusable, and the chat composer holds
 * focus for most of a session, so without this the arrows do nothing at all on
 * the chat page. Scrolling through the element (rather than focusing it) keeps
 * the composer ready to type into, which is the state the page wants to be in.
 */
export function useArrowScroll(scrollRef: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent): void => {
      const el = scrollRef.current;
      if (el === null) return;
      // A dialog over the transcript owns the keyboard, same rule the keymap
      // dispatcher applies to its own bindings.
      if (modalIsOpen()) return;
      const delta = arrowScrollDelta(e, document.activeElement as HTMLElement | null);
      if (delta === null) return;
      e.preventDefault();
      el.scrollBy({ top: delta });
    };

    window.addEventListener('keydown', handler);
    return (): void => {
      window.removeEventListener('keydown', handler);
    };
  }, [scrollRef, enabled]);
}
