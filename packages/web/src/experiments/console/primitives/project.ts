/** Project primitive. Canonical in-spike shape, normalized from server schema. */
export interface Project {
  id: string;
  name: string;
  path: string;
  defaultBranch: string;
  repositoryUrl: string | null;
  lastSyncedAt: string | null;
  /** 'folder' = non-git workspace running in place; 'repo' = git repository. */
  kind: 'repo' | 'folder';
  /**
   * Why the project exists, what is being worked on, and where it has got to.
   *
   * WRITTEN BY THE AGENT, never by hand. It arrives on the project row because
   * that is what it is — a property of the project, not a per-browser note —
   * which also means it is the same on every machine without anything syncing.
   *
   * `null` when nothing has been written yet, which the card says out loud
   * rather than showing a confident blank.
   */
  brief: ProjectBrief | null;
}

/** The three parts of a brief. Split so a stale `doing` cannot discredit a
 *  `why` that is still true. */
export interface ProjectBrief {
  why: string;
  doing: string;
  where: string;
  /** Epoch ms of the last rewrite, so the card can say how fresh it is. */
  updatedAt: number | null;
}

interface RawCodebase {
  id: string;
  name: string;
  default_cwd: string;
  default_branch?: string | null;
  repository_url: string | null;
  kind?: 'repo' | 'folder';
  updated_at: string;
  created_at: string;
  /** The console's own view of the project. Rides along on the row; no
   *  separate request. */
  presentation?: { brief?: Partial<ProjectBrief> | null } | null;
}

/** A brief is worth showing only if it says something. Whitespace is nothing. */
function toBrief(raw: RawCodebase): ProjectBrief | null {
  const b = raw.presentation?.brief;
  if (b === undefined || b === null) return null;
  const brief: ProjectBrief = {
    why: b.why ?? '',
    doing: b.doing ?? '',
    where: b.where ?? '',
    updatedAt: b.updatedAt ?? null,
  };
  return brief.why.trim() === '' && brief.doing.trim() === '' && brief.where.trim() === ''
    ? null
    : brief;
}

export function toProject(raw: RawCodebase): Project {
  return {
    id: raw.id,
    name: raw.name,
    path: raw.default_cwd,
    defaultBranch: raw.default_branch ?? 'main',
    repositoryUrl: raw.repository_url,
    lastSyncedAt: raw.updated_at,
    // Backfill to 'repo' for older payloads (pre-kind); never leaves it undefined.
    kind: raw.kind ?? 'repo',
    brief: toBrief(raw),
  };
}
