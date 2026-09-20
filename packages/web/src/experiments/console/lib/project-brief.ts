/**
 * Why a project exists, what is being worked on, and where it has got to.
 *
 * Three parts, from the prototype: WHY is the standing answer that rarely
 * changes, DOING and WHERE move with the work. Splitting them is what stops it
 * becoming a stale paragraph — the part that goes out of date is visibly a
 * different field from the part that does not.
 *
 * Written by hand, for now. Nothing generates it: the chat brief that used to
 * be synthesised was removed, and inventing project-level prose from run
 * history would be a guess presented as a summary. An empty brief says so and
 * offers to be written rather than showing a confident blank.
 *
 * localStorage, per browser — the same limitation as the project icon and the
 * rail order, and the same upgrade path to a column on `codebases`.
 */
const KEY = 'archon.console.projectBrief';

export interface ProjectBrief {
  /** Why this project exists. Changes rarely. */
  why: string;
  /** What is being worked on now. */
  doing: string;
  /** Where it has got to. */
  where: string;
  /** Epoch ms of the last edit, so the card can say how stale it is. */
  updatedAt: number | null;
}

export const EMPTY_BRIEF: ProjectBrief = { why: '', doing: '', where: '', updatedAt: null };

type Store = Record<string, ProjectBrief>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

export function getBrief(projectId: string): ProjectBrief {
  const hit = read()[projectId];
  return hit === undefined ? EMPTY_BRIEF : { ...EMPTY_BRIEF, ...hit };
}

export function setBrief(projectId: string, next: Partial<ProjectBrief>): void {
  try {
    const store = read();
    store[projectId] = { ...getBrief(projectId), ...next, updatedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* private mode — the brief still edits, it just does not persist */
  }
}

/** True when there is nothing to show, so the card can offer itself instead. */
export function isEmpty(b: ProjectBrief): boolean {
  return b.why.trim() === '' && b.doing.trim() === '' && b.where.trim() === '';
}
