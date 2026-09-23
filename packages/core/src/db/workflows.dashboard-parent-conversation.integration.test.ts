/**
 * Integration test: the dashboard "runs launched by this chat" filter against a
 * REAL bun:sqlite database (#24).
 *
 * The mock-query tests next door assert the SQL text and parameter list; only a
 * real adapter proves the clause actually selects the right rows, composes with
 * the status filter and the count query, and pages correctly.
 *
 * Runs in its own `bun test` invocation (see package.json) — it mock.module's
 * ./connection with a real adapter.
 */
import { describe, test, expect, mock } from 'bun:test';

const realPaths = await import('@archon/paths');
mock.module('@archon/paths', () => ({
  ...realPaths,
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
  getDatabase: () => db,
  getDialect: () => sqliteDialect,
  getDatabaseType: () => 'sqlite',
}));

const { listDashboardRuns } = await import('./workflows');

await db.query(
  `INSERT INTO remote_agent_codebases (id, name, default_cwd, kind)
   VALUES ('cb-1', 'ops-client', '/tmp/ops-client', 'repo')`,
  []
);
for (const [id, platformId] of [
  ['chat-a', 'web-chat-a'],
  ['chat-b', 'web-chat-b'],
  ['worker-1', 'web-worker-1'],
]) {
  await db.query(
    `INSERT INTO remote_agent_conversations (id, platform_type, platform_conversation_id)
     VALUES ($1, 'web', $2)`,
    [id, platformId]
  );
}

/** `parentConversationId` is the ORIGINATING chat, never the worker conversation. */
async function seedRun(
  id: string,
  status: string,
  startedAt: string,
  parentConversationId: string | null
): Promise<void> {
  await db.query(
    `INSERT INTO remote_agent_workflow_runs
       (id, workflow_name, conversation_id, parent_conversation_id, codebase_id, user_message,
        status, metadata, started_at, last_activity_at)
     VALUES ($1, 'implement', 'worker-1', $2, 'cb-1', 'do the thing', $3, '{}', $4, $4)`,
    [id, parentConversationId, status, startedAt]
  );
}

// Chat A launched three runs across two statuses; chat B launched one; the CLI
// run has no originating chat at all (#2008 — a normal state, not an error).
await seedRun('run-a1', 'running', '2026-09-20 10:00:00', 'chat-a');
await seedRun('run-a2', 'completed', '2026-09-20 09:00:00', 'chat-a');
await seedRun('run-a3', 'completed', '2026-09-20 08:00:00', 'chat-a');
await seedRun('run-b1', 'running', '2026-09-20 11:00:00', 'chat-b');
await seedRun('run-cli', 'completed', '2026-09-20 12:00:00', null);

describe('listDashboardRuns parentConversationId filter (#24)', () => {
  test('returns only the runs the given chat launched', async () => {
    const result = await listDashboardRuns({ parentConversationId: 'chat-a' });

    expect(result.runs.map(r => r.id)).toEqual(['run-a1', 'run-a2', 'run-a3']);
    expect(result.total).toBe(3);
    expect(result.counts).toMatchObject({ all: 3, running: 1, completed: 2 });
  });

  test('composes with a status filter', async () => {
    const result = await listDashboardRuns({
      parentConversationId: 'chat-a',
      status: 'completed',
    });

    expect(result.runs.map(r => r.id)).toEqual(['run-a2', 'run-a3']);
    expect(result.total).toBe(2);
    // Counts drop the status filter but keep the chat scope, so the filter bar
    // still totals this chat's runs rather than the whole install's.
    expect(result.counts.all).toBe(3);
  });

  test('composes with limit/offset pagination', async () => {
    const page1 = await listDashboardRuns({ parentConversationId: 'chat-a', limit: 2 });
    const page2 = await listDashboardRuns({
      parentConversationId: 'chat-a',
      limit: 2,
      offset: 2,
    });

    expect(page1.runs.map(r => r.id)).toEqual(['run-a1', 'run-a2']);
    expect(page2.runs.map(r => r.id)).toEqual(['run-a3']);
    expect(page1.total).toBe(3);
  });

  test('composes with a codebase filter', async () => {
    const matching = await listDashboardRuns({
      parentConversationId: 'chat-a',
      codebaseId: 'cb-1',
    });
    const other = await listDashboardRuns({
      parentConversationId: 'chat-a',
      codebaseId: 'cb-absent',
    });

    expect(matching.runs.map(r => r.id)).toEqual(['run-a1', 'run-a2', 'run-a3']);
    expect(other.runs).toEqual([]);
  });

  test('leaves CLI-launched runs listed when no chat filter is applied', async () => {
    const result = await listDashboardRuns();

    expect(result.runs.map(r => r.id)).toContain('run-cli');
    expect(result.total).toBe(5);
  });

  test('an unknown chat id is an empty list, not an error', async () => {
    const result = await listDashboardRuns({ parentConversationId: 'chat-never-ran-anything' });

    expect(result.runs).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.counts.all).toBe(0);
  });
});
