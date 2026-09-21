import type { Run } from './run';

/**
 * A run that says `running` but has stopped.
 *
 * Archon deliberately does not reap these. The server's orphaned-run cleanup
 * exists and is explicitly NOT run at startup, because doing so killed live
 * runs belonging to other processes by flipping their rows to `failed`
 * mid-flight (server/src/index.ts, #1216). CLAUDE.md states the rule: "No
 * Autonomous Lifecycle Mutation Across Process Boundaries — surface ambiguous
 * state to users and provide a one-click action instead."
 *
 * So this module only ever produces a WORD. Nothing here writes, cancels or
 * fails a run. The one-click action already exists: Abandon.
 */

/** Below this, a quiet run is just thinking. A model call can take minutes. */
export const STALL_FLOOR_MS = 30 * 60_000;
/** Above this, no workflow's normal span excuses the silence. */
export const STALL_CEILING_MS = 6 * 60 * 60_000;
/** Used when there is no history to learn a normal span from. Deliberately
 *  generous: a false "Stalled" is worse than a late one. */
export const STALL_FALLBACK_MS = 2 * 60 * 60_000;
/** How many normal spans of silence before the word changes. */
export const STALL_MULTIPLE = 3;
/** Fewer completed runs than this and the median is not worth trusting. */
const MIN_SAMPLES = 3;

const ms = (iso: string | null): number | null => {
  if (iso === null) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/**
 * The median completed span for one workflow, in ms.
 *
 * Median, not mean: one 23-hour zombie in the history would drag a mean far
 * enough to excuse the next zombie. Null when there is not enough history.
 */
export function normalSpanMs(runs: readonly Run[], workflow: string): number | null {
  const spans: number[] = [];
  for (const r of runs) {
    if (r.workflow !== workflow || r.finishedAt === null) continue;
    const a = ms(r.startedAt);
    const b = ms(r.finishedAt);
    if (a === null || b === null || b <= a) continue;
    spans.push(b - a);
  }
  if (spans.length < MIN_SAMPLES) return null;
  spans.sort((x, y) => x - y);
  const mid = Math.floor(spans.length / 2);
  return spans.length % 2 === 0 ? (spans[mid - 1] + spans[mid]) / 2 : spans[mid];
}

/** How long this workflow may go quiet before the word changes. */
export function stallThresholdMs(runs: readonly Run[], workflow: string): number {
  const normal = normalSpanMs(runs, workflow);
  if (normal === null) return STALL_FALLBACK_MS;
  return Math.min(Math.max(normal * STALL_MULTIPLE, STALL_FLOOR_MS), STALL_CEILING_MS);
}

/**
 * True when a run claims to be running and has been silent past its
 * workflow's threshold.
 *
 * A run with no `lastActivityAt` is never called stalled — absent evidence is
 * not evidence, and the whole point is to stop the UI asserting things it
 * cannot see.
 */
export function isStalled(run: Run, runs: readonly Run[], now: number): boolean {
  if (run.status !== 'running') return false;
  const last = ms(run.lastActivityAt);
  if (last === null) return false;
  return now - last > stallThresholdMs(runs, run.workflow);
}

/** The ids of every stalled run in a list, for callers that filter by id. */
export function stalledIds(runs: readonly Run[], now: number): ReadonlySet<string> {
  const out = new Set<string>();
  for (const r of runs) if (isStalled(r, runs, now)) out.add(r.id);
  return out;
}
