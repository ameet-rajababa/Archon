import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Gap between the anchor row and the menu, and the margin kept off each viewport edge. */
const GAP = 4;
const MARGIN = 8;

interface Anchor {
  top: number;
  left: number;
}

export interface RowMenuProps {
  /**
   * The row the menu belongs to; its rect is what the menu is placed against.
   * The element itself rather than a ref, so the value is stable across renders
   * — a fresh `{current}` object each render would re-run the placement effect
   * that sets state, and that is a render loop.
   */
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  width: number;
  children: ReactNode;
  label?: string;
}

/**
 * A row's action menu, rendered outside the list that owns the row.
 *
 * A rail row clips its own contents — `.rail-row` pins its height to its icon,
 * so anything taller is cut — and the list around it scrolls, which clips
 * again. An absolutely-positioned menu inside the row loses to both: it opened
 * correctly and was then sliced to a sliver, which is what made Archive
 * unreachable from the chat rail.
 *
 * So the menu leaves the tree it belongs to. It portals to the body, positions
 * itself against the row's live rect, and flips above the row when there is no
 * room below — the same shape WorkflowPicker's panel already uses. `console-root`
 * travels with it because the console's palette is scoped to that class; without
 * it the menu renders in the production app's colours.
 */
export function RowMenu({
  anchor: row,
  open,
  onClose,
  width,
  children,
  label,
}: RowMenuProps): ReactElement | null {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<Anchor | null>(null);

  // Measured from the rendered panel rather than guessed: the menu is placed
  // after it exists, which is why it renders hidden until there is a position.
  const place = useCallback((): void => {
    if (row === null) return;
    const rect = row.getBoundingClientRect();
    const height = panelRef.current?.offsetHeight ?? 0;
    const below = window.innerHeight - rect.bottom - MARGIN;
    const flip = height > below && rect.top - MARGIN > below;
    setAt({
      top: flip ? Math.max(MARGIN, rect.top - GAP - height) : rect.bottom + GAP,
      // Right-aligned to the row, then pulled back on-screen rather than
      // allowed to run off the edge of a narrow window.
      left: Math.min(
        Math.max(MARGIN, rect.right - width),
        Math.max(MARGIN, window.innerWidth - MARGIN - width)
      ),
    });
  }, [row, width]);

  useLayoutEffect(() => {
    if (!open) {
      setAt(null);
      return;
    }
    place();
    // Capture, so a scroll of the *list* repositions it, not only the window.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return (): void => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent): void => {
      const t = e.target as Node | null;
      if (t !== null && panelRef.current?.contains(t) === true) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return (): void => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-label={label}
      className="console-root fixed z-[1000] rounded-[11px] border p-[5px] shadow-[0_18px_44px_-18px_rgba(0,0,0,0.85)]"
      style={{
        top: at?.top ?? 0,
        left: at?.left ?? 0,
        width,
        // Hidden for the one frame between mounting and being measured, so the
        // menu is never seen at the wrong place.
        visibility: at === null ? 'hidden' : 'visible',
        borderColor: 'var(--border-bright)',
        background: 'var(--surface-hover)',
      }}
    >
      {children}
    </div>,
    document.body
  );
}
