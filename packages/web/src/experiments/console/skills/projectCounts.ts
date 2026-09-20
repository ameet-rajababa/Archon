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
  /**
   * Runs IN PLAY — running, paused or queued. Not the lifetime total.
   *
   * The total was the largest number in the rail and carried the least
   * information: wix-access read 57, of which 45 were completed, 9 failed and
   * 3 cancelled — not one of them needed anything. Meanwhile vault's single
   * executing run was buried inside 22.
   *
   * It also now means the same kind of thing as the chats column beside it,
   * which has always counted ACTIVE chats rather than every chat ever.
   *
   * Failures are deliberately excluded: a failed run is terminal, so it is
   * history until you choose to act on it, and it belongs on the Runs tab.
   */
  runs: number;
  /** Executing right now. */
  running: number;
  /** Waiting on YOU — an approval or an input request. Outranks running. */
  paused: number;
  /**
   * The most recent run statuses, NEWEST FIRST.
   *
   * A count cannot say whether you already fixed the thing — vault and
   * wix-access both failed and then ran again successfully, and a
   * count-in-a-window rule called them "At risk" for days afterwards. Order
   * is what lets a success clear the warning.
   */
  recentStatuses: string[];
  /**
   * Open issues, or null when the repo cannot be asked — no repository, a
   * non-GitHub remote, no token, GitHub unreachable. null renders as an empty
   * cell; 0 would claim the repo has no open issues, which is a different
   * statement and often a false one.
   */
  issues: number | null;
}

interface RunsCountsResponse {
  counts?: { all?: number; running?: number; paused?: number; pending?: number; failed?: number };
  total?: number;
  runs?: { status?: string }[];
}

export async function getProjectCounts(projectId: string): Promise<ProjectCounts> {
  const q = encodeURIComponent(projectId);
  // Both together: neither blocks the other, and a failure in one must not
  // blank the other's number.
  const [chats, runs, issues] = await Promise.allSettled([
    requestJson<unknown[]>(`/api/conversations?codebaseId=${q}&mine=true&archived=active`),
    // limit=10, not 1: `counts` is lifetime, so recent health has to be read
    // from the runs themselves. Ten is enough to distinguish "this keeps
    // failing" from "one failed a month ago" and still a small response.
    requestJson<RunsCountsResponse>(`/api/dashboard/runs?codebaseId=${q}&limit=10`),
    requestJson<{ issues?: { state?: string }[]; reason?: string | null }>(
      `/api/projects/${q}/issues`
    ),
  ]);

  const chatCount =
    chats.status === 'fulfilled' && Array.isArray(chats.value) ? chats.value.length : 0;
  const runsValue = runs.status === 'fulfilled' ? runs.value : null;

  // A route that does not exist yet (or a repo that cannot be asked) means
  // "unknown", not "zero" — the cell stays blank rather than claiming none.
  const issuesValue = issues.status === 'fulfilled' ? issues.value : null;
  const openIssues =
    issuesValue === null || !Array.isArray(issuesValue.issues)
      ? null
      : issuesValue.issues.filter(i => i.state === 'OPEN').length;

  const running = runsValue?.counts?.running ?? 0;
  const paused = runsValue?.counts?.paused ?? 0;
  const pending = runsValue?.counts?.pending ?? 0;

  return {
    chats: chatCount,
    runs: running + paused + pending,
    running,
    paused,
    recentStatuses: (runsValue?.runs ?? []).map(r => r.status ?? ''),
    issues: openIssues,
  };
}
