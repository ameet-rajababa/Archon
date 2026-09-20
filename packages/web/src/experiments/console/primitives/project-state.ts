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
  failed: number;
  openIssues: number;
  chats: number;
}

export function projectState({
  running,
  paused,
  failed,
  openIssues,
  chats,
}: ProjectStateInput): ProjectState {
  const status: ProjectStatus =
    running > 0 ? 'Running' : paused > 0 ? 'Waiting' : openIssues > 0 ? 'Idle' : 'Clear';

  /**
   * Thresholds scaled to the window they are measured over.
   *
   * The prototype used 1 → At risk and 2 → Off track against a handful of
   * fake runs. Measured over the last ten real ones, two failures is a fifth
   * of them — worth flagging, not worth calling the project broken. Three is.
   */
  const health: ProjectHealth | null = failed >= 3 ? 'Off track' : failed >= 1 ? 'At risk' : null;

  const why =
    [
      running > 0 ? `${String(running)} run${running === 1 ? '' : 's'} executing` : null,
      paused > 0 ? `${String(paused)} thing${paused === 1 ? '' : 's'} waiting on you` : null,
      failed > 0 ? `${String(failed)} run${failed === 1 ? '' : 's'} failed` : null,
      openIssues > 0 ? `${String(openIssues)} open issue${openIssues === 1 ? '' : 's'}` : null,
      chats > 0 ? `${String(chats)} chat${chats === 1 ? '' : 's'}` : null,
    ]
      .filter((s): s is string => s !== null)
      .join(' · ') || 'nothing open, nothing running';

  return { status, health, why };
}

export const STATUS_COLOR: Readonly<Record<ProjectStatus, string>> = {
  Running: 'var(--running)',
  Waiting: 'var(--warning, oklch(0.78 0.15 80))',
  Idle: 'var(--text-tertiary)',
  Clear: 'var(--success)',
};

export const HEALTH_COLOR: Readonly<Record<ProjectHealth, string>> = {
  'At risk': 'var(--warning, oklch(0.78 0.15 80))',
  'Off track': 'var(--error)',
};
