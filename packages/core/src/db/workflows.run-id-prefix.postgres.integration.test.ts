/**
 * Integration test: short-id run lookup against a REAL Postgres server.
 *
 * `remote_agent_workflow_runs.id` is a uuid column on Postgres, and Postgres
 * has no `uuid ~~ text` operator — a bare `id LIKE $2` is rejected when the
 * statement is parsed, before it compares anything. So the failure is total
 * rather than partial: the lookup never matched even a full, exact uuid, and
 * `get`, `cancel`, `abandon`, `resume`, `approve`, `reject` and `respond` were
 * all unreachable by the short id every listing prints.
 *
 * The unit suite mocks this function and the SQLite sibling runs on a dialect
 * where `id` is TEXT and the uncast form is perfectly legal, so only a real
 * server can prove the query parses. Same shape as the `getLiveRunOwningEnv`
 * parity test (#2868): a cast that satisfies one backend must not break the
 * other, and neither suite alone can say so.
 *
 * Opt-in via ARCHON_TEST_PG_URL (postgres://user:pass@host:port/db). The test
 * creates and drops its own scratch database; the database named in the URL is
 * only used to reach the server.
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test';
import type { Pool as PgPool } from 'pg';

// The barrel is fully replaced (no partial merge), so re-export the constants
// the real module graph needs: bundled-schema reads BUNDLED_IS_BINARY. The
// '@archon/paths/bundled-build' subpath is a separate specifier and stays real.
mock.module('@archon/paths', () => ({
  BUNDLED_IS_BINARY: false,
  createLogger: () => ({
    info() {},
    warn() {},
    error() {},
    debug() {},
    trace() {},
    fatal() {},
  }),
}));

const baseUrl = process.env.ARCHON_TEST_PG_URL;
const SCRATCH_DB = 'archon_run_id_prefix_test';

const RUN_A = '0b1ee8da-1111-2222-3333-444455556666';
const RUN_B = '0b1ee8da-9999-8888-7777-666655554444';
const OTHER_PROJECT_RUN = '7c3f01aa-1111-2222-3333-444455556666';

describe.skipIf(!baseUrl)('findWorkflowRunsByIdPrefix — real Postgres behavior', () => {
  let admin: PgPool;
  let db: import('./adapters/postgres').PostgresAdapter;
  let findWorkflowRunsByIdPrefix: typeof import('./workflows').findWorkflowRunsByIdPrefix;
  let codebaseId: string;
  let otherCodebaseId: string;

  beforeAll(async () => {
    const { Pool } = await import('pg');
    admin = new Pool({ connectionString: baseUrl });
    // SCRATCH_DB is a compile-time constant, safe to inline as an identifier.
    await admin.query(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${SCRATCH_DB}"`);
    const scratchUrl = new URL(baseUrl!);
    scratchUrl.pathname = `/${SCRATCH_DB}`;

    const { PostgresAdapter, postgresDialect } = await import('./adapters/postgres');
    db = new PostgresAdapter(scratchUrl.toString());

    mock.module('./connection', () => ({
      pool: db,
      getDatabase: () => db,
      getDialect: () => postgresDialect,
      getDatabaseType: () => 'postgresql',
    }));

    ({ findWorkflowRunsByIdPrefix } = await import('./workflows'));

    const codebases = await db.query<{ id: string }>(
      `INSERT INTO remote_agent_codebases (name, default_cwd, kind)
       VALUES ('ops-client', '/tmp/ops-client', 'repo'), ('other', '/tmp/other', 'repo')
       RETURNING id`
    );
    [codebaseId, otherCodebaseId] = codebases.rows.map(row => row.id);

    await db.query(
      `INSERT INTO remote_agent_conversations (id, platform_type, platform_conversation_id)
       VALUES ($1, 'cli', 'conv-1-platform')`,
      ['11111111-1111-4111-8111-111111111111']
    );
    for (const [id, owner] of [
      [RUN_A, codebaseId],
      [RUN_B, codebaseId],
      [OTHER_PROJECT_RUN, otherCodebaseId],
    ] as const) {
      await db.query(
        `INSERT INTO remote_agent_workflow_runs (id, conversation_id, codebase_id, workflow_name, user_message, status)
         VALUES ($1, '11111111-1111-4111-8111-111111111111', $2, 'archon-deliver', 'go', 'completed')`,
        [id, owner]
      );
    }
  });

  afterAll(async () => {
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`);
      await admin.end();
    }
  });

  // The assertion that fails at PARSE time without the cast, taking every case
  // below with it — which is what made the whole surface unreachable.
  test('the short id a listing prints resolves to its run', async () => {
    const found = await findWorkflowRunsByIdPrefix('0b1ee8da', codebaseId);
    expect(found.map(run => run.id).sort()).toEqual([RUN_A, RUN_B].sort());
  });

  test('a full uuid resolves to exactly that run', async () => {
    const found = await findWorkflowRunsByIdPrefix(RUN_A, codebaseId);
    expect(found.map(run => run.id)).toEqual([RUN_A]);
  });

  test('a run in another project is not reachable through this one', async () => {
    await expect(findWorkflowRunsByIdPrefix('7c3f01aa', codebaseId)).resolves.toEqual([]);
  });
});
