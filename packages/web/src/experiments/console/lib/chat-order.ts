/**
 * A hand-arranged order for a project's chats.
 *
 * Sorting by recency is self-maintaining but puts whatever was touched last on
 * top, which is not always what matters. A manual order is stable by
 * definition, so a chat stays where it was put.
 *
 * Held in localStorage per project. It is a view preference, not data, and it
 * deliberately does not follow between devices.
 */

const KEY_PREFIX = 'archon.console.chatOrder.';

export function chatOrderKey(projectId: string): string {
  return `${KEY_PREFIX}${projectId}`;
}

export function readChatOrder(projectId: string): string[] {
  try {
    const raw = localStorage.getItem(chatOrderKey(projectId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    // A hand-edited or newer-build value must not crash the rail.
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function writeChatOrder(projectId: string, order: readonly string[]): void {
  try {
    localStorage.setItem(chatOrderKey(projectId), JSON.stringify(order));
  } catch {
    // Best-effort: failing to remember an order must not break the rail.
  }
}

/**
 * Apply a manual order to a list that is already sorted by recency.
 *
 * Ids in the order come first, in that order. Anything not in it — a chat
 * created since, or one never dragged — keeps its recency position behind them,
 * so a new chat is never hidden by an order that predates it.
 */
export function applyChatOrder<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[]
): T[] {
  const byId = new Map(items.map(i => [i.id, i]));
  const ranked: T[] = [];
  for (const id of order) {
    const hit = byId.get(id);
    if (hit !== undefined) {
      ranked.push(hit);
      byId.delete(id);
    }
  }
  // Map preserves insertion order, so the remainder is still recency-sorted.
  return [...ranked, ...byId.values()];
}

/**
 * The order after dragging `dragId` onto `targetId`.
 *
 * Built from the list as currently displayed, so dragging while filtered still
 * produces a coherent full order rather than one that only describes the rows
 * that happened to be visible.
 */
export function reorder(
  displayed: readonly { id: string }[],
  dragId: string,
  targetId: string
): string[] {
  const ids = displayed.map(i => i.id);
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from === -1 || to === -1 || from === to) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, dragId);
  return next;
}

/**
 * A row's vertical slot, captured once when a drag starts.
 *
 * `height` is the whole slot — the row plus the gap below it — so consecutive
 * boxes tile the list without holes to fall through.
 */
export interface RowBox {
  /** Viewport-relative top edge at the moment the drag started. */
  top: number;
  /** Distance to the next row's top edge. */
  height: number;
}

/** Slot geometry from measured rects. The last row borrows the list's gap. */
export function rowBoxes(rects: readonly { top: number; bottom: number }[], gap: number): RowBox[] {
  return rects.map((r, i) => ({
    top: r.top,
    height: (rects[i + 1]?.top ?? r.bottom + gap) - r.top,
  }));
}

/**
 * Which row index a cursor sits over, given the geometry captured at drag start
 * and how far the list has scrolled since.
 *
 * Measured against the captured boxes rather than live ones on purpose: the
 * preview moves rows with a transform, so a live hit test would keep targeting
 * a row that has already slid out from under the cursor, and the list would
 * oscillate between two answers for as long as the pointer stayed still.
 */
export function dropIndexAt(boxes: readonly RowBox[], y: number, scrolledBy = 0): number {
  if (boxes.length === 0) return -1;
  const at = y + scrolledBy;
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    if (box !== undefined && at < box.top + box.height) return i;
  }
  return boxes.length - 1;
}

/**
 * How far the row at `index` must move, in pixels, to show what dropping the
 * row at `from` onto the row at `to` would produce.
 *
 * Every row between the two slides one slot towards the gap the dragged row is
 * about to leave, and the dragged row slides the whole of that distance the
 * other way. Positive is down. This is the finished layout, drawn before the
 * drop rather than after it, which is the only way the user can tell a drop
 * that lands where they meant from one that does not.
 */
export function previewShift(
  boxes: readonly RowBox[],
  from: number,
  to: number,
  index: number
): number {
  const dragged = boxes[from];
  if (dragged === undefined || boxes[to] === undefined || from === to) return 0;
  const span = (a: number, b: number): number =>
    boxes.slice(a, b + 1).reduce((sum, box) => sum + box.height, 0);
  if (to > from) {
    if (index === from) return span(from + 1, to);
    return index > from && index <= to ? -dragged.height : 0;
  }
  if (index === from) return -span(to, from - 1);
  return index >= to && index < from ? dragged.height : 0;
}

/**
 * The same function, named for what it actually is.
 *
 * `applyChatOrder` is list-agnostic — it takes ids and returns the list
 * rearranged — and the project rail needs exactly the same behavior. Aliased
 * rather than duplicated so the "new item is never hidden by a stale order"
 * rule has one implementation.
 */
export const applyManualOrder = applyChatOrder;
