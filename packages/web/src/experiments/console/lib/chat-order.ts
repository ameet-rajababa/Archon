/**
 * Arranging a rail by hand: the order itself, and the drag that produces it.
 *
 * Sorting by recency is self-maintaining but puts whatever was touched last on
 * top, which is not always what matters — a rail of working chats rearranges
 * itself under the reader as replies land. A hand-arranged order is absolute:
 * nothing but a drag moves a row.
 *
 * Where that order LIVES differs by rail. A chat's position is a column on the
 * conversation row, so it follows the reader to any browser; the project rail
 * still keeps its order here, in localStorage. The functions below are the
 * shared part — applying an order to a list, folding a displayed subset back
 * into a full one, and the drag geometry both rails draw with.
 */

/**
 * The chat rail's old home, kept only to migrate off it.
 *
 * Read once when nothing in a project has a stored position yet, so an
 * arrangement made before the column existed survives the upgrade, and cleared
 * as soon as the server holds one. Nothing writes it any more.
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

export function clearChatOrder(projectId: string): void {
  try {
    localStorage.removeItem(chatOrderKey(projectId));
  } catch {
    // Best-effort: a browser that will not forget is not worth breaking a rail over.
  }
}

/**
 * Rearrange a list to match an order given as ids.
 *
 * An id the order has never seen belongs to something created since it was
 * written, and new goes on TOP: appended to the tail it would be buried under
 * every arranged row, which is precisely where a brand-new row cannot be
 * found. Those keep the incoming list's own order among themselves — recency,
 * for both rails — so the newest of them leads.
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
  return [...byId.values(), ...ranked];
}

/**
 * Fold a displayed arrangement back into a full stored order.
 *
 * Writing the displayed rows AS the order is the bug this replaces: the
 * project rail is search-filtered, so dragging while a query was active wrote
 * an order made only of the rows that matched and lost the places of every
 * project the query hid.
 *
 * Each displayed id takes a slot the order already holds for a displayed id,
 * filled in the sequence just displayed; every id that was out of view keeps
 * its own slot untouched. An id with no slot is new and takes one at the top —
 * the same rule `applyChatOrder` drew it with, so what is written matches what
 * was on screen. This is the id-array form of what a per-row position column
 * does for chats: reuse the positions in play, disturb nothing else.
 *
 * Ids of rows that no longer exist are kept, not pruned: from a filtered list
 * a deleted id and a hidden one are indistinguishable, and dropping a row's
 * slot because a query hid it is how it lost its place.
 */
export function mergeChatOrder(stored: readonly string[], displayed: readonly string[]): string[] {
  // Deduplicated because a repeated id would claim a second slot and push the
  // last id off the end of the order.
  const queue = [...new Set(displayed)];
  const shown = new Set(queue);
  const slots = [...new Set(stored)];
  const known = new Set(slots);
  const withSlots = [...queue.filter(id => !known.has(id)), ...slots];
  let next = 0;
  // Slot count and queue length match by construction; `?? id` is there so a
  // future caller cannot silently lose a row to an off-by-one.
  return withSlots.map(id => (shown.has(id) ? (queue[next++] ?? id) : id));
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
 * The same functions, named for what they actually are.
 *
 * `applyChatOrder` and `mergeChatOrder` are list-agnostic — they take ids and
 * return ids — and the project rail needs exactly the same behavior from a
 * search-filtered list that the chat rail needs from a scope-filtered one.
 * Aliased rather than duplicated so "new goes on top" and "an out-of-view row
 * keeps its slot" each have one implementation.
 */
export const applyManualOrder = applyChatOrder;
export const mergeManualOrder = mergeChatOrder;
