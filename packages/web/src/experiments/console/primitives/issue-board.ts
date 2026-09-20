/**
 * Where an issue sits on the board.
 *
 * Read-only derivation. Nothing here writes to GitHub.
 *
 *   done  ← issue.state === CLOSED                          (GitHub)
 *   rev   ← an open PR lists it in closingIssuesReferences  (GitHub GraphQL)
 *   prog  ← an Archon run is executing against it           (Archon runs)
 *   todo  ← everything else
 *
 * The middle two are the whole point of the board. GitHub alone gives you Open
 * and Closed; the status it does not have comes from joining it to what Archon
 * already knows.
 */
import type { GithubIssue } from '../skills';

export type IssueColumn = 'todo' | 'prog' | 'rev' | 'done';

export const ISSUE_COLUMNS: readonly { key: IssueColumn; label: string; color: string }[] = [
  { key: 'todo', label: 'Todo', color: 'var(--text-tertiary)' },
  { key: 'prog', label: 'In Progress', color: 'var(--running)' },
  { key: 'rev', label: 'In Review', color: 'var(--warning, var(--st-rev, oklch(0.75 0.15 85)))' },
  { key: 'done', label: 'Done', color: 'var(--success)' },
];

/** Why a card is where it is — shown on hover, so the join is inspectable. */
export const COLUMN_REASON: Readonly<Record<IssueColumn, string>> = {
  todo: 'GitHub · open, nothing else known',
  prog: 'Archon · a run is working on it',
  rev: 'GitHub · an open PR closes it',
  done: 'GitHub · the issue is closed',
};

export function issueColumn(
  issue: GithubIssue,
  runningIssueNumbers: ReadonlySet<number>
): IssueColumn {
  if (issue.state === 'CLOSED') return 'done';
  if (issue.openPr) return 'rev';
  if (runningIssueNumbers.has(issue.number)) return 'prog';
  return 'todo';
}

/**
 * The GitHub issue TYPE, or one derived from a legacy label.
 *
 * Types are the MECE taxonomy; labels are not. `bug` as a label meant the same
 * thing before types existed, so it still reads — but the card marks a derived
 * type differently from a real one, because they are not the same claim.
 */
const LEGACY_TYPE: Readonly<Record<string, string>> = {
  bug: 'Bug',
  enhancement: 'Feature',
  documentation: 'Task',
  question: 'Task',
  invalid: 'Task',
  duplicate: 'Task',
  wontfix: 'Task',
};

/**
 * GitHub ships one hex per type, tuned for GitHub's own light UI. Reused
 * verbatim they read at 3.1:1 on white and 3.6:1 on our dark surfaces, so
 * these point at mode-aware tokens instead and inherit the AA tuning.
 */
export const TYPE_COLOR: Readonly<Record<string, string>> = {
  Bug: 'var(--type-bug)',
  Feature: 'var(--type-feature)',
  Task: 'var(--type-task)',
};

export function issueType(issue: GithubIssue): { name: string; derived: boolean } | null {
  if (issue.type !== null && issue.type !== '') return { name: issue.type, derived: false };
  for (const l of issue.labels) {
    const hit = LEGACY_TYPE[l.name.toLowerCase()];
    if (hit !== undefined) return { name: hit, derived: true };
  }
  return null;
}

/**
 * An AREA is a part of the system, and GitHub has no field for it — the
 * convention that exists in real repos is a prefixed label. coleam00/Archon
 * uses exactly this: `area: workflows`, `area: cli`. The prefix is stripped
 * for display, so the chip says `workflows`.
 */
const AREA_PREFIX = /^area\s*:\s*/i;

export function issueAreas(issue: GithubIssue): { name: string; color: string }[] {
  return issue.labels
    .filter(l => AREA_PREFIX.test(l.name))
    .map(l => ({ name: l.name.replace(AREA_PREFIX, ''), color: `#${l.color}` }));
}

/** Issue numbers named by a run that is executing right now. */
export function runningIssues(
  runs: readonly { status: string; userMessage?: string | null }[]
): Set<number> {
  const out = new Set<number>();
  for (const r of runs) {
    if (r.status !== 'running') continue;
    const text = r.userMessage ?? '';
    for (const m of text.matchAll(/#(\d{1,6})\b/g)) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) out.add(n);
    }
  }
  return out;
}
