/**
 * A hand-arranged order for the project rail.
 *
 * The same shape as the chat order, and deliberately the same primitives —
 * `rowBoxes`, `dropIndexAt`, `previewShift` and `reorder` are list-agnostic and
 * already carry the hard-won behavior (geometry captured once at drag start,
 * a transform preview that never reflows, an index-based commit that matches
 * what the preview showed). Only where the order is stored differs.
 *
 * localStorage, per browser. It is a view preference, not data.
 */
const KEY = 'archon.console.projectOrder';

export function readProjectOrder(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function writeProjectOrder(order: readonly string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    // Failing to remember an order must not break the rail.
  }
}
