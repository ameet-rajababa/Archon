/** What the persistent project header says on its right-hand side. */

export interface HeaderCounts {
  running: number;
  paused: number;
}

/**
 * Live activity for the project being viewed, or null when there is none.
 *
 * Null rather than "0 running" on purpose: an idle project should show nothing
 * at all. A permanent zero is noise that teaches you to stop reading the
 * corner, which defeats the point of putting it there.
 *
 * Paused is included because a paused run is waiting on *you* — it is the one
 * state where not noticing has a cost.
 */
export function activitySummary(counts: HeaderCounts | null | undefined): string | null {
  if (counts == null) return null;
  const parts: string[] = [];
  if (counts.running > 0) parts.push(`${counts.running.toString()} running`);
  if (counts.paused > 0) parts.push(`${counts.paused.toString()} paused`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * True when the activity is waiting on the user rather than merely in progress.
 * Drives the colour: work in flight is informational, work that has stopped for
 * a human is not.
 */
export function activityNeedsYou(counts: HeaderCounts | null | undefined): boolean {
  return counts != null && counts.paused > 0;
}

/**
 * The second line when no project is scoped. The header keeps its two lines in
 * every state so that picking a project never changes its height — anything
 * below it would otherwise jump.
 */
export function allProjectsSubtitle(
  projectCount: number,
  counts: HeaderCounts | null | undefined
): string {
  const projects = `${projectCount.toString()} project${projectCount === 1 ? '' : 's'}`;
  const activity = activitySummary(counts);
  return activity === null ? projects : `${projects} · ${activity}`;
}

/**
 * Which tab the header lights, derived from the URL rather than passed in —
 * the header renders in the layout, above and outside the page that knows.
 *
 * A run detail lights Runs, not nothing: a run belongs to Runs, and an
 * unlit tab strip on a run page reads as "you have left the project".
 */
export function activeProjectTab(pathname: string): 'overview' | 'runs' | 'chat' | 'issues' {
  if (/\/chat\/?$/.test(pathname)) return 'chat';
  if (/\/issues\/?$/.test(pathname)) return 'issues';
  if (/\/overview\/?$/.test(pathname)) return 'overview';
  // Runs is the bare project path AND a run's detail page, which has no tab of
  // its own — a run belongs to Runs, so that is what stays lit while you read
  // one.
  return 'runs';
}
