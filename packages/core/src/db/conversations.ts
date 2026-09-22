/**
 * Database operations for conversations
 */
import { pool, getDialect } from './connection';
import { looksLikeRowId } from './codebases';
import type { Conversation } from '../types';
import { ConversationNotFoundError } from '../types';
import { createLogger } from '@archon/paths';
import { loadConfig } from '../config/config-loader';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('db.conversations');
  return cachedLog;
}

/**
 * Get a conversation by its database ID
 */
export async function getConversationById(id: string): Promise<Conversation | null> {
  const result = await pool.query<Conversation>(
    'SELECT * FROM remote_agent_conversations WHERE id = $1',
    [id]
  );
  return result.rows[0] ?? null;
}

/**
 * Find a conversation by platform_conversation_id only (no platform_type filter).
 * Safe because all platform IDs are globally unique (they include platform prefix + timestamp + random).
 * Used by the Web UI API to load conversations from any platform.
 */
export async function findConversationByPlatformId(
  platformId: string
): Promise<Conversation | null> {
  const result = await pool.query<Conversation>(
    'SELECT * FROM remote_agent_conversations WHERE platform_conversation_id = $1',
    [platformId]
  );
  return result.rows[0] ?? null;
}

/**
 * Get a conversation by platform type and platform ID
 * Returns null if not found (unlike getOrCreate which creates)
 */
export async function getConversationByPlatformId(
  platformType: string,
  platformId: string
): Promise<Conversation | null> {
  const result = await pool.query<Conversation>(
    'SELECT * FROM remote_agent_conversations WHERE platform_type = $1 AND platform_conversation_id = $2',
    [platformType, platformId]
  );
  return result.rows[0] ?? null;
}

export async function getOrCreateConversation(
  platformType: string,
  platformId: string,
  codebaseId?: string,
  parentConversationId?: string,
  userId?: string
): Promise<Conversation> {
  const existing = await pool.query<Conversation>(
    'SELECT * FROM remote_agent_conversations WHERE platform_type = $1 AND platform_conversation_id = $2',
    [platformType, platformId]
  );

  if (existing.rows[0]) {
    // First-user-wins: do not overwrite user_id on subsequent messages in the
    // same thread from a different user. Per-message attribution lives on
    // workflow_runs/messages instead.
    return existing.rows[0];
  }

  // Check if we should inherit from a parent conversation (e.g., Discord thread inheriting from parent channel)
  let inheritedCodebaseId: string | null = null;
  let inheritedCwd: string | null = null;
  let assistantType: string | undefined;

  if (parentConversationId) {
    const parent = await pool.query<Conversation>(
      'SELECT * FROM remote_agent_conversations WHERE platform_type = $1 AND platform_conversation_id = $2',
      [platformType, parentConversationId]
    );
    if (parent.rows[0]) {
      inheritedCodebaseId = parent.rows[0].codebase_id;
      inheritedCwd = parent.rows[0].cwd;
      assistantType = parent.rows[0].ai_assistant_type;
      getLog().debug(
        { inheritedCodebaseId, inheritedCwd },
        'db.conversation_parent_context_inherited'
      );
    }
  }

  // Use provided codebase or inherited codebase
  const finalCodebaseId = codebaseId ?? inheritedCodebaseId;

  // Determine assistant type from codebase if provided (overrides inherited)
  if (codebaseId) {
    const codebase = await pool.query<{ ai_assistant_type: string }>(
      'SELECT ai_assistant_type FROM remote_agent_codebases WHERE id = $1',
      [codebaseId]
    );
    if (codebase.rows[0]) {
      assistantType = codebase.rows[0].ai_assistant_type;
    }
  }

  // No parent or codebase signal: resolve the configured default assistant
  // instead of hard-defaulting to Claude (#2241). loadConfig() owns the
  // fallback chain — explicit config (repo assistant > global defaultAssistant)
  // > DEFAULT_AI_ASSISTANT env > first registered built-in provider. The
  // per-user default assistant (#1998) deliberately stays OUT of this row: the
  // orchestrator applies it per turn (userAiPrefs.defaultProvider ??
  // conversation.ai_assistant_type), sender-first (#1982), so a personal
  // preference is never baked into a shared conversation.
  if (assistantType === undefined) {
    try {
      const config = await loadConfig();
      assistantType = config.assistant;
    } catch (err) {
      // Intentional fallback: a broken config (e.g. an unregistered
      // DEFAULT_AI_ASSISTANT value makes loadConfig throw) must not block
      // conversation creation — the turn itself surfaces config errors.
      getLog().warn(
        { err: err instanceof Error ? err.message : String(err) },
        'db.conversation_default_assistant_config_load_failed'
      );
    }
  }
  assistantType ??= 'claude';

  const created = await pool.query<Conversation>(
    'INSERT INTO remote_agent_conversations (platform_type, platform_conversation_id, ai_assistant_type, codebase_id, cwd, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [platformType, platformId, assistantType, finalCodebaseId, inheritedCwd, userId ?? null]
  );

  return created.rows[0];
}

export async function updateConversation(
  id: string,
  updates: Partial<Pick<Conversation, 'codebase_id' | 'cwd' | 'isolation_env_id'>> & {
    hidden?: boolean;
  }
): Promise<void> {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  let i = 1;

  if (updates.codebase_id !== undefined) {
    fields.push(`codebase_id = $${String(i++)}`);
    values.push(updates.codebase_id);
  }
  if (updates.cwd !== undefined) {
    fields.push(`cwd = $${String(i++)}`);
    values.push(updates.cwd);
  }
  if (updates.isolation_env_id !== undefined) {
    fields.push(`isolation_env_id = $${String(i++)}`);
    values.push(updates.isolation_env_id);
  }
  if (updates.hidden !== undefined) {
    fields.push(`hidden = $${String(i++)}`);
    values.push(updates.hidden ? 1 : 0);
  }

  if (fields.length === 0) {
    return; // No updates
  }

  const dialect = getDialect();
  fields.push(`updated_at = ${dialect.now()}`);
  values.push(id);

  const result = await pool.query(
    `UPDATE remote_agent_conversations SET ${fields.join(', ')} WHERE id = $${String(i)}`,
    values
  );

  if (result.rowCount === 0) {
    getLog().error({ conversationId: id, fields, updates }, 'db.conversation_update_not_found');
    throw new ConversationNotFoundError(id);
  }
}

/**
 * Find a conversation by isolation environment ID (legacy - single result)
 * Used for provider-based lookup and shared environment detection
 */
export async function getConversationByIsolationEnvId(envId: string): Promise<Conversation | null> {
  const result = await pool.query<Conversation>(
    'SELECT * FROM remote_agent_conversations WHERE isolation_env_id = $1 LIMIT 1',
    [envId]
  );
  return result.rows[0] ?? null;
}

/**
 * Find all conversations using a specific isolation environment (new UUID model)
 */
export async function getConversationsByIsolationEnvId(
  envId: string
): Promise<readonly Conversation[]> {
  const result = await pool.query<Conversation>(
    'SELECT * FROM remote_agent_conversations WHERE isolation_env_id = $1',
    [envId]
  );
  return result.rows;
}

/**
 * List all conversations ordered by recent activity
 */
export async function listConversations(
  limit = 50,
  platformType?: string,
  codebaseId?: string,
  excludeEmpty = false,
  /**
   * Non-enforcing "mine" filter: when set, restrict to conversations attributed
   * to this user (`user_id = $N`). Absent → all (default visibility stays open).
   */
  userId?: string,
  /**
   * Which archived state to return. `active` (the default) preserves the
   * historic behaviour exactly; `archived` returns only soft-deleted rows so
   * they can be listed and restored; `all` returns both.
   */
  archived: 'active' | 'archived' | 'all' = 'active'
): Promise<readonly Conversation[]> {
  const params: unknown[] = [];
  const archivedClause =
    archived === 'active'
      ? 'deleted_at IS NULL'
      : archived === 'archived'
        ? 'deleted_at IS NOT NULL'
        : '1 = 1';
  let sql = `SELECT * FROM remote_agent_conversations WHERE ${archivedClause} AND (hidden IS NULL OR hidden = false)`;

  if (excludeEmpty) {
    sql +=
      ' AND (title IS NOT NULL OR EXISTS (SELECT 1 FROM remote_agent_messages WHERE conversation_id = remote_agent_conversations.id LIMIT 1))';
  }

  if (platformType) {
    params.push(platformType);
    sql += ` AND platform_type = $${String(params.length)}`;
  }

  if (codebaseId) {
    // A filter value that cannot be a row id matches nothing, and saying so is
    // the whole answer. Comparing it to a uuid column raises a driver error
    // instead, which the route above turns into a 500 — the console showed
    // five of those at once when a URL carried a project name where an id
    // belonged. See `looksLikeRowId`.
    if (!looksLikeRowId(codebaseId)) return [];
    params.push(codebaseId);
    sql += ` AND codebase_id = $${String(params.length)}`;
  }

  if (userId) {
    params.push(userId);
    sql += ` AND user_id = $${String(params.length)}`;
  }

  sql += ' ORDER BY last_activity_at DESC NULLS LAST';
  params.push(limit);
  sql += ` LIMIT $${String(params.length)}`;

  const result = await pool.query<Conversation>(sql, params);
  return result.rows;
}

/**
 * Update last_activity_at for staleness tracking
 */
export async function touchConversation(id: string): Promise<void> {
  const dialect = getDialect();
  await pool.query(
    `UPDATE remote_agent_conversations SET last_activity_at = ${dialect.now()} WHERE id = $1`,
    [id]
  );
}

/**
 * Update conversation title
 */
export async function updateConversationTitle(id: string, title: string): Promise<void> {
  const dialect = getDialect();
  const result = await pool.query(
    `UPDATE remote_agent_conversations SET title = $1, updated_at = ${dialect.now()} WHERE id = $2`,
    [title, id]
  );
  if (result.rowCount === 0) {
    throw new ConversationNotFoundError(id);
  }
}

/**
 * Archive or restore a conversation.
 *
 * Archiving is the same soft delete `softDeleteConversation` performs; this
 * exists so the two directions are one symmetric call, because an archive the
 * user cannot undo is a delete wearing a friendlier word.
 */
export async function setConversationArchived(id: string, archived: boolean): Promise<void> {
  const dialect = getDialect();
  const result = await pool.query(
    `UPDATE remote_agent_conversations SET deleted_at = ${archived ? dialect.now() : 'NULL'}, updated_at = ${dialect.now()} WHERE id = $1`,
    [id]
  );
  if (result.rowCount === 0) {
    throw new ConversationNotFoundError(id);
  }
}

/**
 * Set or clear a conversation's color label.
 *
 * `null` clears it. The value is validated at the API boundary against
 * CONVERSATION_COLORS; this layer stores whatever it is handed.
 */
export async function updateConversationColor(id: string, color: string | null): Promise<void> {
  const dialect = getDialect();
  const result = await pool.query(
    `UPDATE remote_agent_conversations SET color = $1, updated_at = ${dialect.now()} WHERE id = $2`,
    [color, id]
  );
  if (result.rowCount === 0) {
    throw new ConversationNotFoundError(id);
  }
}

/**
 * Resolve platform conversation ids to database ids, in one query.
 *
 * The conversation API addresses chats by platform id throughout, and a rail
 * names fifty of them at once; resolving those one at a time would be fifty
 * round trips to arrange one list. Ids with no row are simply absent from the
 * result — the caller decides what an unknown chat means.
 */
export async function findConversationIdsByPlatformIds(
  platformIds: readonly string[]
): Promise<Map<string, string>> {
  if (platformIds.length === 0) return new Map();
  const placeholders = platformIds.map((_, i) => `$${String(i + 1)}`).join(', ');
  const result = await pool.query<{ id: string; platform_conversation_id: string }>(
    `SELECT id, platform_conversation_id FROM remote_agent_conversations WHERE platform_conversation_id IN (${placeholders})`,
    [...platformIds]
  );
  return new Map(result.rows.map(r => [r.platform_conversation_id, r.id]));
}

/**
 * The ascending values a displayed run of chats should hold, given what they
 * hold now.
 *
 * The rail only ever shows a subset — one archive scope, or a search — so it
 * can only speak for the chats it can see. Reusing exactly the values those
 * chats already hold is what lets it say "these, in this order" without
 * knowing, or disturbing, a single chat that was out of view.
 *
 * A chat with no value yet needs one, and it has to be able to end up above
 * everything already placed, so the range is extended DOWNWARD: `missing` new
 * values immediately below the lowest one in play. Which chat receives which
 * value is decided by position alone — the caller's sequence — so a brand-new
 * chat dragged to the bottom takes the highest value, not a seed.
 */
export function nextOrderSlots(current: readonly (number | null)[]): number[] {
  const taken = current.filter((v): v is number => v !== null).sort((a, b) => a - b);
  const missing = current.length - taken.length;
  // `?? 0` is the empty case: nothing has ever been arranged, so the run simply
  // starts somewhere. Negative values are as valid as any other.
  const base = taken[0] ?? 0;
  const seeds = Array.from({ length: missing }, (_, i) => base - missing + i);
  return [...seeds, ...taken];
}

/**
 * Arrange a run of chats: `ids` is the order they should appear in, top first.
 *
 * Ids that do not exist are skipped rather than consuming a position, so a
 * stale row in a rail that has not refreshed cannot shift everything below it.
 * Rows whose value is already correct are not written at all, which keeps the
 * ordinary drag — where only the chats between the two ends actually move — to
 * a handful of statements instead of one per visible chat.
 */
export async function setConversationOrder(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const dialect = getDialect();
  const placeholders = ids.map((_, i) => `$${String(i + 1)}`).join(', ');
  const existing = await pool.query<{ id: string; sort_order: number | null }>(
    `SELECT id, sort_order FROM remote_agent_conversations WHERE id IN (${placeholders})`,
    [...ids]
  );
  const current = new Map(existing.rows.map(r => [r.id, r.sort_order]));
  const present = ids.filter(id => current.has(id));
  const slots = nextOrderSlots(present.map(id => current.get(id) ?? null));

  for (const [i, id] of present.entries()) {
    const next = slots[i];
    if (next === undefined || next === current.get(id)) continue;
    await pool.query(
      `UPDATE remote_agent_conversations SET sort_order = $1, updated_at = ${dialect.now()} WHERE id = $2`,
      [next, id]
    );
  }
}

/**
 * Soft delete a conversation (sets deleted_at timestamp)
 */
export async function softDeleteConversation(id: string): Promise<void> {
  const dialect = getDialect();
  const result = await pool.query(
    `UPDATE remote_agent_conversations SET deleted_at = ${dialect.now()}, updated_at = ${dialect.now()} WHERE id = $1`,
    [id]
  );
  if (result.rowCount === 0) {
    throw new ConversationNotFoundError(id);
  }
}
