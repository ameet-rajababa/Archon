/**
 * The numbers a project row shows: how many chats, how many runs, how many of
 * those runs are going right now.
 *
 * Its OWN cache key, deliberately. The obvious shortcut is to reuse `runs:*`,
 * which RunsPage already populates — but that key is fetched there with
 * `limit: RUN_LIMIT` and here it would want `limit: 1`, and two different
 * limits under one key means whichever request lands first decides what the
 * other reader sees. That bug has already been fixed once in this codebase;
 * this is the same shape.
 *
 * `limit=1` because only `counts` and `total` are wanted. The rail must not
 * pay for two hundred run records to draw a number.
 */
import { requestJson } from '../lib/http';

export interface ProjectCounts {
  chats: number;
  runs: number;
  /** Runs executing right now — the rail tints this one. */
  running: number;
}

interface RunsCountsResponse {
  counts?: { all?: number; running?: number };
  total?: number;
}

export async function getProjectCounts(projectId: string): Promise<ProjectCounts> {
  const q = encodeURIComponent(projectId);
  // Both together: neither blocks the other, and a failure in one must not
  // blank the other's number.
  const [chats, runs] = await Promise.allSettled([
    requestJson<unknown[]>(`/api/conversations?codebaseId=${q}&mine=true&archived=active`),
    requestJson<RunsCountsResponse>(`/api/dashboard/runs?codebaseId=${q}&limit=1`),
  ]);

  const chatCount =
    chats.status === 'fulfilled' && Array.isArray(chats.value) ? chats.value.length : 0;
  const runsValue = runs.status === 'fulfilled' ? runs.value : null;

  return {
    chats: chatCount,
    // `total` is the honest count; `counts.all` can be capped by the limit.
    runs: runsValue?.total ?? runsValue?.counts?.all ?? 0,
    running: runsValue?.counts?.running ?? 0,
  };
}
