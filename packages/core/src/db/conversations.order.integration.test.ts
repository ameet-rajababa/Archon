/**
 * Integration test: arranging the chat rail against a REAL bun:sqlite database.
 *
 * The unit tests prove `nextOrderSlots` in isolation. What they cannot prove is
 * the claim the whole design rests on: that arranging the chats one archive
 * scope is showing leaves every chat it is NOT showing exactly where it was.
 * That is a statement about rows in a table, so it is tested against rows in a
 * table — including the column actually existing, which a mocked pool cannot
 * tell you.
 *
 * Runs in its own `bun test` invocation (see package.json) — it mock.module's
 * ./connection with a real adapter, conflicting with other db tests' fakes.
 */
import { describe, test, expect, mock } from 'bun:test';

// The real @archon/paths, with only the logger silenced: mocking it wholesale
// means every export the import chain reaches for has to be restated here, and
// that list is not this test's business.
const paths = await import('@archon/paths');
mock.module('@archon/paths', () => ({
  ...paths,
  createLogger: () => ({
    info() {},
    warn() {},
    error() {},
    debug() {},
    trace() {},
    fatal() {},
  }),
}));

const { SqliteAdapter, sqliteDialect } = await import('./adapters/sqlite');
const db = new SqliteAdapter(':memory:');

mock.module('./connection', () => ({
  pool: db,
  getDialect: () => sqliteDialect,
  getDatabaseType: () => 'sqlite',
}));

const { setConversationOrder, findConversationIdsByPlatformIds } = await import('./conversations');

async function insertChat(id: string): Promise<void> {
  await db.query(
    `INSERT INTO remote_agent_conversations (id, platform_type, platform_conversation_id)
     VALUES ($1, 'web', $2)`,
    [id, `${id}-platform`]
  );
}

/** Every chat's position, by id. */
async function positions(): Promise<Record<string, number | null>> {
  const rows = await db.query<{ id: string; sort_order: number | null }>(
    'SELECT id, sort_order FROM remote_agent_conversations',
    []
  );
  return Object.fromEntries(rows.rows.map(r => [r.id, r.sort_order]));
}

/** The ids in the order the rail would draw them: position first, ties aside. */
async function arranged(): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    'SELECT id FROM remote_agent_conversations ORDER BY sort_order ASC',
    []
  );
  return rows.rows.map(r => r.id);
}

describe('arranging chats in a real database', () => {
  test('a fresh chat has no position until one is given', async () => {
    await insertChat('fresh');
    expect(await positions()).toEqual({ fresh: null });

    await setConversationOrder(['fresh']);
    // Nothing else is in play, so the run simply starts somewhere.
    expect((await positions()).fresh).toBe(-1);
  });

  test('arranging one scope does not move the chats it cannot see', async () => {
    await db.query('DELETE FROM remote_agent_conversations', []);
    for (const id of ['a', 'b', 'c', 'x', 'y']) await insertChat(id);

    // Everything placed once, as the rail does on first sight.
    await setConversationOrder(['a', 'b', 'c', 'x', 'y']);
    const before = await positions();
    expect(await arranged()).toEqual(['a', 'b', 'c', 'x', 'y']);

    // Now the rail shows only 'a', 'b', 'c' — the other two are archived, out
    // of view, and unnamed. Drag 'c' to the top of what is showing.
    await setConversationOrder(['c', 'a', 'b']);

    const after = await positions();
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // The three visible chats permuted the three positions they already held,
    // so the two hidden chats still sit exactly where they did.
    expect(await arranged()).toEqual(['c', 'a', 'b', 'x', 'y']);
  });

  test('a chat with no position can be placed above every chat that has one', async () => {
    await db.query('DELETE FROM remote_agent_conversations', []);
    for (const id of ['old-1', 'old-2']) await insertChat(id);
    await setConversationOrder(['old-1', 'old-2']);

    await insertChat('new');
    // The rail shows the new chat on top, and says so.
    await setConversationOrder(['new', 'old-1', 'old-2']);

    expect(await arranged()).toEqual(['new', 'old-1', 'old-2']);
    const p = await positions();
    expect(p.new).toBeLessThan(p['old-1'] as number);
  });

  test('re-sending the same arrangement changes nothing', async () => {
    await db.query('DELETE FROM remote_agent_conversations', []);
    for (const id of ['a', 'b']) await insertChat(id);
    await setConversationOrder(['a', 'b']);
    const before = await positions();

    await setConversationOrder(['a', 'b']);

    // No drift: the positions in play are reused, not re-based. A rail that
    // re-sent on every poll would otherwise walk the whole project downward.
    expect(await positions()).toEqual(before);
  });

  test('platform ids resolve to rows in one query', async () => {
    await db.query('DELETE FROM remote_agent_conversations', []);
    await insertChat('a');

    const found = await findConversationIdsByPlatformIds(['a-platform', 'never-existed']);

    expect(found.get('a-platform')).toBe('a');
    expect(found.has('never-existed')).toBe(false);
  });
});
