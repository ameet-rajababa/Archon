/**
 * A project's state, in one or two words.
 *
 * Ported from the prototype, including the reasoning that made it one word.
 *
 * Status is exclusive and ordered by urgency, which is what lets it be a word
 * rather than a list. Health is ABSENT when things are fine, so the second
 * word appearing is itself the signal — "Running" alone says more than
 * "Running · Healthy" ever could.
 *
 * Chats are deliberately not workload. A project you have talked about but
 * have no issues or runs in is Clear, not Idle: counting conversation as work
 * is how a status stops meaning anything.
 */

export type ProjectStatus = 'Running' | 'Waiting' | 'Idle' | 'Clear';
export type ProjectHealth = 'At risk' | 'Off track';

export interface ProjectState {
  status: ProjectStatus;
  health: ProjectHealth | null;
  /** The arithmetic behind the word, for the tooltip. */
  why: string;
}

export interface ProjectStateInput {
  running: number;
  /** Runs paused on an approval or an input request — waiting on the reader. */
  paused: number;
  /**
   * Recent run statuses, NEWEST FIRST.
   *
   * Not a failure count. Counting failures in a window cannot tell whether you
   * already fixed the thing — a success has to be able to clear the warning,
   * or it is a scar rather than a signal.
   */
  recentStatuses: readonly string[];
  openIssues: number;
  chats: number;
}

export function projectState({
  running,
  paused,
  recentStatuses,
  openIssues,
  chats,
}: ProjectStateInput): ProjectState {
  /**
   * How many of the MOST RECENT runs failed, consecutively.
   *
   * The streak is what matters. One failure at the head says the last thing
   * you tried is broken; two or more says it is not a blip. A success at the
   * head ends it immediately, which is what lets the signal recover — vault
   * and wix-access both failed, then ran again and succeeded, and a
   * count-in-a-window rule was still calling them "At risk" days later.
   */
  let failStreak = 0;
  for (const status of recentStatuses) {
    if (status !== 'failed') break;
    failStreak += 1;
  }

  const health: ProjectHealth | null =
    failStreak >= 2 ? 'Off track' : failStreak === 1 ? 'At risk' : null;

  /**
   * Clear means clear.
   *
   * "Clear · At risk" said nothing is wrong and something is wrong in the same
   * breath. A project whose last run failed has unfinished business, so the
   * most it can be is Idle — and "Idle · At risk" reads correctly: nothing is
   * happening, and the last thing that did, failed.
   */
  const status: ProjectStatus =
    running > 0
      ? 'Running'
      : paused > 0
        ? 'Waiting'
        : openIssues > 0 || health !== null
          ? 'Idle'
          : 'Clear';

  const why =
    [
      running > 0 ? `${String(running)} run${running === 1 ? '' : 's'} executing` : null,
      paused > 0 ? `${String(paused)} thing${paused === 1 ? '' : 's'} waiting on you` : null,
      failStreak === 1
        ? 'the last run failed'
        : failStreak > 1
          ? `the last ${String(failStreak)} runs failed`
          : null,
      openIssues > 0 ? `${String(openIssues)} open issue${openIssues === 1 ? '' : 's'}` : null,
      chats > 0 ? `${String(chats)} chat${chats === 1 ? '' : 's'}` : null,
    ]
      .filter((s): s is string => s !== null)
      .join(' · ') || 'nothing open, nothing running';

  return { status, health, why };
}

export const STATUS_COLOR: Readonly<Record<ProjectStatus, string>> = {
  Running: 'var(--running)',
  Waiting: 'var(--warning)',
  Idle: 'var(--text-tertiary)',
  Clear: 'var(--success)',
};

export const HEALTH_COLOR: Readonly<Record<ProjectHealth, string>> = {
  'At risk': 'var(--warning)',
  'Off track': 'var(--error)',
};
