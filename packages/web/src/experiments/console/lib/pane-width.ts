/**
 * A pane you can drag wider, remembered per browser.
 *
 * Two panes are resizable — the project rail and the chat rail — and the rule
 * they follow is the same one: clamp to the pane's own bounds, fall back to
 * its default for anything unreadable, and persist only on release. Written
 * once here so a fix to one is a fix to both; the bounds themselves stay with
 * each pane, because 232–440 for a rail of projects and 200–420 for a rail of
 * chats are not a pair that has to agree.
 *
 * localStorage rather than the server: a width is a property of the SCREEN you
 * are reading on, not of the account. The same arrangement synced to a laptop
 * and a 32" monitor would be wrong on one of them.
 */

export interface PaneBounds {
  /** localStorage key. */
  key: string;
  min: number;
  max: number;
  /** Used for an absent, unparseable, or out-of-bounds stored value. */
  initial: number;
}

/** Hold a width inside its pane's bounds. */
export function clampPaneWidth(width: number, { min, max }: PaneBounds): number {
  return Math.max(min, Math.min(max, width));
}

/**
 * The stored width, or the default.
 *
 * An out-of-bounds stored value is DISCARDED rather than clamped: it means the
 * bounds moved since it was written, and the pane's current default is a
 * better answer than whichever edge the old value happens to land on.
 */
export function readPaneWidth(bounds: PaneBounds): number {
  try {
    const v = parseInt(localStorage.getItem(bounds.key) ?? '', 10);
    return v >= bounds.min && v <= bounds.max ? v : bounds.initial;
  } catch {
    // Storage disabled (private mode, blocked cookies). A pane that cannot
    // remember its width is a pane at its default, not a broken rail.
    return bounds.initial;
  }
}

export function writePaneWidth(bounds: PaneBounds, width: number): void {
  try {
    localStorage.setItem(bounds.key, String(width));
  } catch {
    /* ignore — see readPaneWidth */
  }
}
