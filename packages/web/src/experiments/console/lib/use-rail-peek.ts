/**
 * Peek is armed by MOVEMENT, not by presence.
 *
 * `mouseenter` fires whenever a new element appears under a STATIONARY cursor,
 * and this rail re-renders constantly. So collapsing with ⌘. while the pointer
 * happened to be resting over the rail re-opened it by itself, with the mouse
 * never touched — and the next render re-armed it again. Presence is not intent.
 *
 * A `mousemove` cannot fire without the mouse moving, so watching the document
 * for movement over the rail IS the intent test. Bound to the document rather
 * than to the rail element, which React replaces underneath us.
 *
 * Ported from the prototype, where this behaviour was built and tested.
 */
import { useEffect, useRef, useState } from 'react';

const PEEK_DWELL_MS = 280;

export function useRailPeek(collapsed: boolean, expandedWidth: number): boolean {
  const [peeking, setPeeking] = useState(false);
  // Read inside the listener without re-binding it on every change.
  const state = useRef({ collapsed, peeking, expandedWidth });
  state.current = { collapsed, peeking, expandedWidth };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cancel = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    const onMove = (e: MouseEvent): void => {
      const s = state.current;
      if (!s.collapsed) {
        cancel();
        return;
      }
      const rail = document.querySelector('.rail-panel');
      if (rail === null) return;
      const b = rail.getBoundingClientRect();
      // While peek is opening the width is mid-animation, so the measured right
      // edge trails the pointer. Test against the width it is travelling TO, or
      // a fast move into the panel closes it on the way in.
      const right = s.peeking ? Math.max(b.right, s.expandedWidth) : b.right;
      const over =
        e.clientX >= b.left && e.clientX <= right && e.clientY >= b.top && e.clientY <= b.bottom;

      if (over) {
        if (s.peeking) return;
        // Not reset by later moves: the dwell runs from the first movement
        // INSIDE the rail, so sweeping across on the way elsewhere never opens
        // it, but arriving and stopping still does.
        if (timer === null) {
          timer = setTimeout(() => {
            timer = null;
            setPeeking(true);
          }, PEEK_DWELL_MS);
        }
        return;
      }

      cancel();
      // A menu raised FROM the rail is rendered outside the rail's box. Closing
      // the rail out from under the thing it just opened is the same bug
      // wearing a different hat.
      if (s.peeking && document.querySelector('[role="menu"]') === null) setPeeking(false);
    };

    document.addEventListener('mousemove', onMove, { passive: true });
    return (): void => {
      cancel();
      document.removeEventListener('mousemove', onMove);
    };
  }, []);

  // Expanding must drop the peek, or the rail comes back already peeked.
  useEffect(() => {
    if (!collapsed) setPeeking(false);
  }, [collapsed]);

  return collapsed && peeking;
}
