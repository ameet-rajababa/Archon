/**
 * Database connection management with auto-detection
 *
 * Strategy:
 * - If DATABASE_URL is set: Use PostgreSQL (shared with server)
 * - Otherwise: Use SQLite at ~/.archon/archon.db (standalone CLI)
 */
import { join } from 'path';
import { getArchonHome } from '@archon/paths';
import type { DbNotificationListener, IDatabase, SqlDialect, QueryResult } from './adapters/types';
import { PostgresAdapter, postgresDialect } from './adapters/postgres';
import { SqliteAdapter, sqliteDialect } from './adapters/sqlite';
import { readSchemaVersion, type SchemaVersionInfo } from './schema-version';
import { createLogger } from '@archon/paths';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('db.connection');
  return cachedLog;
}

// Singleton database instance
let database: IDatabase | null = null;
let dialect: SqlDialect | null = null;

/**
 * Where the SQLite registry lives when DATABASE_URL is unset.
 *
 * Exported because a caller that needs to know whether the registry EXISTS must
 * test the same path this module opens — deriving it independently means a future
 * relocation silently answers about the wrong file. `scripts/migrate-state-dir.ts`
 * is that caller: it skips a read-only lookup when the file is absent, and a stale
 * path there would send a migration to the wrong destination without erroring.
 */
export function getSqliteDbPath(): string {
  return join(getArchonHome(), 'archon.db');
}

/**
 * The PostgreSQL DSN this process may open, or null to use the SQLite registry.
 * The single owner of that choice — `getDatabase()` and `getDatabaseType()` must
 * not each re-read the environment, or they can disagree about which backend is live.
 *
 * A test runner never inherits `DATABASE_URL`. Exporting the DSN of the live
 * Archon is normal on a self-hosted box, and a test that spawns the CLI hands its
 * own environment to the child — so an inherited DSN sent fixture registrations
 * (`workflow run --folder` auto-registers its working directory) into the
 * operator's production database, where 17 `/tmp/...` projects showed up in their
 * real project list. Redirecting `ARCHON_HOME` does not help: the DSN wins over
 * the home before the scratch registry is ever consulted.
 *
 * Falling back to SQLite rather than throwing is what the caller wants — a test's
 * registry is the scratch home beside it — and the warning makes the refusal
 * visible rather than silent. A test that genuinely needs PostgreSQL opens an
 * adapter against `ARCHON_TEST_PG_URL` instead; the only tests that need this key
 * to mean what it means in production are the ones asserting this rule, which
 * declare themselves with `ARCHON_TEST_ALLOW_DATABASE_URL=1`.
 */
function resolvePostgresUrl(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (process.env.NODE_ENV === 'test' && process.env.ARCHON_TEST_ALLOW_DATABASE_URL !== '1') {
    getLog().warn(
      { hint: 'Set ARCHON_TEST_ALLOW_DATABASE_URL=1 if this test really means to use it.' },
      'db.test_run_ignoring_database_url'
    );
    return null;
  }
  return url;
}

/**
 * Get or create the database connection
 * Auto-detects PostgreSQL vs SQLite based on DATABASE_URL
 */
export function getDatabase(): IDatabase {
  if (database) {
    return database;
  }

  const postgresUrl = resolvePostgresUrl();
  if (postgresUrl) {
    getLog().info('db.connection_postgresql_selected');
    database = new PostgresAdapter(postgresUrl);
    dialect = postgresDialect;
  } else {
    const dbPath = getSqliteDbPath();
    getLog().info({ dbPath }, 'db.connection_sqlite_selected');
    database = new SqliteAdapter(dbPath);
    dialect = sqliteDialect;

    // Warn if running in Docker without DATABASE_URL — the postgres container
    // from --profile with-db is running but the app is silently using SQLite
    if (process.env.ARCHON_DOCKER === 'true') {
      getLog().warn(
        {
          hint: 'Add DATABASE_URL=postgresql://postgres:postgres@postgres:5432/remote_coding_agent to .env to use PostgreSQL',
          current: dbPath,
        },
        'db.docker_using_sqlite'
      );
    }
  }

  return database;
}

/**
 * Get the SQL dialect for the current database
 */
export function getDialect(): SqlDialect {
  if (!dialect) {
    // Initialize database to set dialect
    getDatabase();
  }

  if (!dialect) {
    throw new Error(
      'Database dialect not initialized. This indicates the database connection failed during initialization. ' +
        'Check logs for database connection errors.'
    );
  }

  return dialect;
}

/**
 * Get the current database type without initializing the database
 * Useful for version/info commands that don't need a connection
 */
export function getDatabaseType(): 'postgresql' | 'sqlite' {
  return resolvePostgresUrl() ? 'postgresql' : 'sqlite';
}

/**
 * Read the recorded schema vintage (#2316): which Archon build created this database
 * and which last applied schema to it. Returns null when no row was ever written.
 * Diagnostic only — no caller gates on it.
 */
export async function getSchemaVersion(): Promise<SchemaVersionInfo | null> {
  return readSchemaVersion(getDatabase());
}

/** Type guard: does this database implement the optional notification-listener capability? */
function isDbNotificationListener(db: IDatabase): db is IDatabase & DbNotificationListener {
  return typeof (db as Partial<DbNotificationListener>).listen === 'function';
}

/**
 * Return the active database as a notification listener (Postgres `LISTEN/NOTIFY`),
 * or null when the backend doesn't support it (SQLite). Feature-detection seam so
 * the server can opt into real-time push only when available.
 */
export function getDbNotificationListener(): DbNotificationListener | null {
  if (getDatabaseType() !== 'postgresql') return null;
  const db = getDatabase();
  return isDbNotificationListener(db) ? db : null;
}

/**
 * Close the database connection
 */
export async function closeDatabase(): Promise<void> {
  if (database) {
    await database.close();
    database = null;
    dialect = null;
  }
}

/**
 * Reset database for testing
 */
export function resetDatabase(): void {
  database = null;
  dialect = null;
}

// Legacy export for backward compatibility during migration
// This provides a pool-like interface that forwards to getDatabase()
export const pool = {
  query: async <T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> => {
    return getDatabase().query<T>(sql, params);
  },
  end: async (): Promise<void> => {
    await closeDatabase();
  },
};
