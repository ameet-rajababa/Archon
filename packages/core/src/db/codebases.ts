/**
 * Database operations for codebases
 */
import { sep as pathSep } from 'path';
import { pool, getDialect } from './connection';
import type { Codebase } from '../types';
import { createLogger, captureCodebaseRegistered } from '@archon/paths';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('db.codebases');
  return cachedLog;
}

export async function createCodebase(data: {
  name: string;
  repository_url?: string;
  default_cwd: string;
  default_branch?: string | null;
  ai_assistant_type?: string;
  kind?: 'repo' | 'folder';
}): Promise<Codebase> {
  const assistantType = data.ai_assistant_type ?? process.env.DEFAULT_AI_ASSISTANT ?? 'claude';
  const result = await pool.query<Codebase>(
    'INSERT INTO remote_agent_codebases (name, repository_url, default_cwd, default_branch, ai_assistant_type, kind) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [
      data.name,
      data.repository_url ?? null,
      data.default_cwd,
      data.default_branch ?? null,
      assistantType,
      data.kind ?? 'repo',
    ]
  );
  if (!result.rows[0]) {
    throw new Error('Failed to create codebase: INSERT succeeded but no row returned');
  }
  // Anonymous count-only telemetry (activation funnel: install → registered a
  // project). Every registration surface (HTTP clone/register, /register-project
  // chat command) funnels through this INSERT — no name/path/URL is ever sent.
  captureCodebaseRegistered();
  return result.rows[0];
}

/**
 * Whether a string could be a row id at all.
 *
 * `remote_agent_codebases.id` is a uuid column on PostgreSQL, so comparing it
 * to a string that is not a uuid is not a miss — it is a type error, raised by
 * the driver and caught by whatever generic handler is above it. The console
 * turned that into a 500 on five endpoints at once when a URL carried a
 * project NAME where an id belonged, which reads as "the server is broken"
 * rather than "no such project".
 *
 * A value that cannot be a uuid cannot be in a uuid column, so the honest
 * answer is the empty one. Checked here rather than matched on the driver's
 * error text, which would be reading prose to make a control-flow decision.
 * SQLite never raised the error and already returned nothing; this makes both
 * backends agree.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeRowId(id: string): boolean {
  return UUID_RE.test(id);
}

export async function getCodebase(id: string): Promise<Codebase | null> {
  if (!looksLikeRowId(id)) return null;
  const result = await pool.query<Codebase>('SELECT * FROM remote_agent_codebases WHERE id = $1', [
    id,
  ]);
  return result.rows[0] || null;
}

export async function updateCodebaseCommands(
  id: string,
  commands: Record<string, { path: string; description: string }>
): Promise<void> {
  const dialect = getDialect();
  await pool.query(
    `UPDATE remote_agent_codebases SET commands = $1, updated_at = ${dialect.now()} WHERE id = $2`,
    [JSON.stringify(commands), id]
  );
}

export async function getCodebaseCommands(
  id: string
): Promise<Record<string, { path: string; description: string }>> {
  const result = await pool.query<{
    commands: Record<string, { path: string; description: string }> | string;
  }>('SELECT commands FROM remote_agent_codebases WHERE id = $1', [id]);
  const raw = result.rows[0]?.commands;
  // SQLite returns TEXT columns as strings; PostgreSQL JSONB returns objects
  let parsed: Record<string, { path: string; description: string }>;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      getLog().error({ codebaseId: id, raw, err }, 'db.codebase_commands_json_parse_failed');
      throw new Error(
        `Corrupt commands JSON for codebase ${id}: unable to parse stored data. ` +
          `Run UPDATE remote_agent_codebases SET commands = '{}' WHERE id = '${id}' to reset.`
      );
    }
  } else {
    parsed = raw ?? {};
  }
  // Spread to ensure mutable copy - Bun's SQLite driver returns frozen objects
  return { ...parsed };
}

export async function registerCommand(
  id: string,
  name: string,
  command: { path: string; description: string }
): Promise<void> {
  const commands = await getCodebaseCommands(id);
  commands[name] = command;
  await updateCodebaseCommands(id, commands);
}

export async function findCodebaseByRepoUrl(repoUrl: string): Promise<Codebase | null> {
  const result = await pool.query<Codebase>(
    'SELECT * FROM remote_agent_codebases WHERE repository_url = $1',
    [repoUrl]
  );
  return result.rows[0] || null;
}

export async function findCodebaseByDefaultCwd(defaultCwd: string): Promise<Codebase | null> {
  const result = await pool.query<Codebase>(
    'SELECT * FROM remote_agent_codebases WHERE default_cwd = $1 ORDER BY created_at DESC LIMIT 1',
    [defaultCwd]
  );
  return result.rows[0] || null;
}

/**
 * Find a codebase whose `default_cwd` equals `cwdPath` or is a true ancestor
 * DIRECTORY of it (boundary-anchored on the path separator). Used for
 * subdirectory runs (worktree subdirs, or a subdirectory of a folder-project
 * root) where an exact `findCodebaseByDefaultCwd` match returns null.
 *
 * Matching is done in application code, NOT via SQL `LIKE default_cwd || '%'`,
 * which was wrong on two counts: (1) `_`/`%` in a stored path are LIKE
 * wildcards, and (2) a bare `%` suffix has no separator boundary, so a sibling
 * directory sharing a name prefix (`/x/platform` vs `/x/platform-staging`)
 * would match. Returns the most specific (longest `default_cwd`) match.
 */
export async function findCodebaseByPathPrefix(cwdPath: string): Promise<Codebase | null> {
  const result = await pool.query<Codebase>('SELECT * FROM remote_agent_codebases');
  let best: Codebase | null = null;
  for (const row of result.rows) {
    const base = row.default_cwd;
    const isMatch = cwdPath === base || cwdPath.startsWith(base + pathSep);
    if (isMatch && (best === null || base.length > best.default_cwd.length)) {
      best = row;
    }
  }
  return best;
}

export async function findCodebaseByName(name: string): Promise<Codebase | null> {
  const result = await pool.query<Codebase>(
    'SELECT * FROM remote_agent_codebases WHERE name = $1 ORDER BY created_at DESC LIMIT 1',
    [name]
  );
  return result.rows[0] || null;
}

/**
 * Error thrown when an UPDATE matched no codebase row (row deleted between
 * fetch and update). Lets callers distinguish "row gone" from operational
 * DB failures (connection refused, timeout, constraint violation).
 */
export class CodebaseNotFoundError extends Error {
  constructor(public codebaseId: string) {
    super(`Codebase ${codebaseId} not found`);
    this.name = 'CodebaseNotFoundError';
  }
}

export async function updateCodebase(
  id: string,
  data: { default_cwd?: string; repository_url?: string | null; default_branch?: string | null }
): Promise<void> {
  const dialect = getDialect();
  const updates: string[] = [];
  const values: (string | null)[] = [];
  let paramIndex = 1;

  if (data.default_cwd !== undefined) {
    updates.push(`default_cwd = $${paramIndex++}`);
    values.push(data.default_cwd);
  }

  if (data.repository_url !== undefined) {
    updates.push(`repository_url = $${paramIndex++}`);
    values.push(data.repository_url);
  }

  if (data.default_branch !== undefined) {
    updates.push(`default_branch = $${paramIndex++}`);
    values.push(data.default_branch);
  }

  if (updates.length === 0) return;

  updates.push(`updated_at = ${dialect.now()}`);
  values.push(id);

  const result = await pool.query(
    `UPDATE remote_agent_codebases SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
    values
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new CodebaseNotFoundError(id);
  }
}

export async function listCodebases(): Promise<readonly Codebase[]> {
  const result = await pool.query<Codebase>(
    'SELECT * FROM remote_agent_codebases ORDER BY name ASC'
  );
  return result.rows;
}

export async function deleteCodebase(id: string): Promise<void> {
  getLog().debug({ codebaseId: id }, 'db.codebase_delete_cascade_started');
  // First, unlink any sessions referencing this codebase (FK has no cascade)
  await pool.query('UPDATE remote_agent_sessions SET codebase_id = NULL WHERE codebase_id = $1', [
    id,
  ]);
  // Second, unlink any conversations referencing this codebase (FK has no cascade)
  await pool.query(
    'UPDATE remote_agent_conversations SET codebase_id = NULL WHERE codebase_id = $1',
    [id]
  );
  // Then delete the codebase
  await pool.query('DELETE FROM remote_agent_codebases WHERE id = $1', [id]);
  getLog().info({ codebaseId: id }, 'db.codebase_delete_completed');
}

/**
 * The console's own view of a project: icon, colour, brief, rail position.
 *
 * Opaque to the server. Nothing here interprets the blob — these are
 * presentation, nothing queries by icon, and a shape that keeps growing as the
 * console grows should not cost a migration each time.
 */
export interface CodebasePresentation {
  presentation: Record<string, unknown> | null;
  sortOrder: number | null;
}

export async function getCodebasePresentation(id: string): Promise<CodebasePresentation | null> {
  const res = await pool.query<{ presentation: unknown; sort_order: number | null }>(
    'SELECT presentation, sort_order FROM remote_agent_codebases WHERE id = $1',
    [id]
  );
  const row = res.rows[0];
  if (row === undefined) return null;
  // SQLite hands JSON back as text; Postgres hands back an object.
  const raw = typeof row.presentation === 'string' ? safeParse(row.presentation) : row.presentation;
  return {
    presentation: typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null,
    sortOrder: row.sort_order,
  };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Merge a patch into the presentation blob.
 *
 * Read-modify-write in JS rather than Postgres' `jsonb ||`, because the same
 * code has to work on SQLite. The merge is shallow, which is what "set the
 * icon, leave the brief alone" has to mean.
 *
 * Two tabs saving different fields in the same instant can lose one of them.
 * That is a real race and an acceptable one here: the loser is a single
 * presentation field on a single-user console, and the alternative is
 * dialect-specific SQL for a value nothing queries.
 */
export async function updateCodebasePresentation(
  id: string,
  patch: Record<string, unknown>
): Promise<void> {
  const dialect = getDialect();
  const current = await getCodebasePresentation(id);
  const next = { ...(current?.presentation ?? {}), ...patch };
  await pool.query(
    `UPDATE remote_agent_codebases SET presentation = $1, updated_at = ${dialect.now()} WHERE id = $2`,
    [JSON.stringify(next), id]
  );
}

/** NULL means never dragged, and sorts last — a new project does not jump to the top. */
export async function updateCodebaseSortOrder(id: string, sortOrder: number | null): Promise<void> {
  const dialect = getDialect();
  await pool.query(
    `UPDATE remote_agent_codebases SET sort_order = $1, updated_at = ${dialect.now()} WHERE id = $2`,
    [sortOrder, id]
  );
}
