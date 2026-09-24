/**
 * Integration test: short-id run lookup against a REAL bun:sqlite database.
 *
 * `findWorkflowRunsByIdPrefix` is the resolver behind every short id a listing
 * prints, so `archon workflow get|cancel|abandon|resume` and the approve /
 * reject / respond gates all reach a run through it. Every existing test mocks
 * it, which means its SQL has never executed in the suite on either dialect —
 * and the SQL is exactly where it can break, because `id` is a uuid column on
 * Postgres and TEXT on SQLite and the comparison has to satisfy both.
 *
 * The Postgres half is proved by the `.postgres.` sibling; this half proves the
 * same query parses and matches on SQLite, so a cast chosen to satisfy one
 * backend cannot quietly break the other.
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

const { findWorkflowRunsByIdPrefix } = await import('./workflows');

const RUN_A = '0b1ee8da-1111-2222-3333-444455556666';
const RUN_B = '0b1ee8da-9999-8888-7777-666655554444';
const OTHER_PROJECT_RUN = '7c3f01aa-1111-2222-3333-444455556666';

await db.query(
  `INSERT INTO remote_agent_codebases (id, name, default_cwd, kind)
   VALUES ('cb-1', 'ops-client', '/tmp/ops-client', 'repo'),
          ('cb-2', 'other', '/tmp/other', 'repo')`,
  []
);
await db.query(
  `INSERT INTO remote_agent_conversations (id, platform_type, platform_conversation_id)
   VALUES ('conv-1', 'web', 'conv-1-platform')`,
  []
);
for (const [id, codebaseId] of [
  [RUN_A, 'cb-1'],
  [RUN_B, 'cb-1'],
  [OTHER_PROJECT_RUN, 'cb-2'],
] as const) {
  await db.query(
    `INSERT INTO remote_agent_workflow_runs (id, conversation_id, codebase_id, workflow_name, user_message, status)
     VALUES ($1, 'conv-1', $2, 'archon-deliver', 'go', 'completed')`,
    [id, codebaseId]
  );
}

describe('findWorkflowRunsByIdPrefix — real SQLite', () => {
  test('the short id a listing prints resolves to its run', async () => {
    const found = await findWorkflowRunsByIdPrefix('0b1ee8da', 'cb-1');
    expect(found.map(run => run.id).sort()).toEqual([RUN_A, RUN_B].sort());
  });

  test('a full uuid resolves to exactly that run', async () => {
    const found = await findWorkflowRunsByIdPrefix(RUN_A, 'cb-1');
    expect(found.map(run => run.id)).toEqual([RUN_A]);
  });

  // The scope that stops a short id meaning two different runs to two projects.
  test('a run in another project is not reachable through this one', async () => {
    await expect(findWorkflowRunsByIdPrefix('7c3f01aa', 'cb-1')).resolves.toEqual([]);
  });

  test('a prefix outside the uuid charset is refused before it reaches SQL', async () => {
    await expect(findWorkflowRunsByIdPrefix('%', 'cb-1')).resolves.toEqual([]);
    await expect(findWorkflowRunsByIdPrefix('_b1ee8da', 'cb-1')).resolves.toEqual([]);
    await expect(findWorkflowRunsByIdPrefix('', 'cb-1')).resolves.toEqual([]);
  });
});
