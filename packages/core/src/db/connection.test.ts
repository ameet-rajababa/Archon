import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { getDatabaseType, resetDatabase } from './connection';

describe('connection', () => {
  describe('getDatabaseType', () => {
    let originalDatabaseUrl: string | undefined;
    let originalAllow: string | undefined;

    beforeEach(() => {
      originalDatabaseUrl = process.env.DATABASE_URL;
      originalAllow = process.env.ARCHON_TEST_ALLOW_DATABASE_URL;
      // These cases assert the production selection rule, so they opt out of the
      // guard that otherwise makes a test run ignore an inherited DATABASE_URL.
      process.env.ARCHON_TEST_ALLOW_DATABASE_URL = '1';
      // Reset the database singleton to ensure clean state
      resetDatabase();
    });

    afterEach(() => {
      // Restore original DATABASE_URL
      if (originalDatabaseUrl !== undefined) {
        process.env.DATABASE_URL = originalDatabaseUrl;
      } else {
        delete process.env.DATABASE_URL;
      }
      if (originalAllow !== undefined) {
        process.env.ARCHON_TEST_ALLOW_DATABASE_URL = originalAllow;
      } else {
        delete process.env.ARCHON_TEST_ALLOW_DATABASE_URL;
      }
      resetDatabase();
    });

    it('should return postgresql when DATABASE_URL is set', () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
      expect(getDatabaseType()).toBe('postgresql');
    });

    it('should return sqlite when DATABASE_URL is not set', () => {
      delete process.env.DATABASE_URL;
      expect(getDatabaseType()).toBe('sqlite');
    });

    it('should return postgresql for any truthy DATABASE_URL value', () => {
      process.env.DATABASE_URL = 'postgres://user:pass@host:5432/db';
      expect(getDatabaseType()).toBe('postgresql');

      process.env.DATABASE_URL = 'postgresql://localhost/mydb';
      expect(getDatabaseType()).toBe('postgresql');
    });

    it('should return sqlite when DATABASE_URL is empty string', () => {
      process.env.DATABASE_URL = '';
      expect(getDatabaseType()).toBe('sqlite');
    });

    it('should not initialize database connection', () => {
      // getDatabaseType should work without connecting to database
      // This is important for version command that runs without db
      delete process.env.DATABASE_URL;

      // Should not throw even without a database available
      const result = getDatabaseType();
      expect(result).toBe('sqlite');
    });
  });

  /**
   * A self-hosted operator exports the DSN of their LIVE Archon, and a test that
   * spawns the CLI hands its own environment to the child. Without this refusal an
   * inherited DSN put fixture projects, runs and conversations into the operator's
   * production database — `NODE_ENV=test` is set by the runner and inherited by
   * every process it spawns, which is what makes the refusal reach the child too.
   */
  describe('inherited DATABASE_URL under a test runner', () => {
    let originalDatabaseUrl: string | undefined;
    let originalAllow: string | undefined;

    beforeEach(() => {
      originalDatabaseUrl = process.env.DATABASE_URL;
      originalAllow = process.env.ARCHON_TEST_ALLOW_DATABASE_URL;
      resetDatabase();
    });

    afterEach(() => {
      if (originalDatabaseUrl !== undefined) {
        process.env.DATABASE_URL = originalDatabaseUrl;
      } else {
        delete process.env.DATABASE_URL;
      }
      if (originalAllow !== undefined) {
        process.env.ARCHON_TEST_ALLOW_DATABASE_URL = originalAllow;
      } else {
        delete process.env.ARCHON_TEST_ALLOW_DATABASE_URL;
      }
      resetDatabase();
    });

    it('is ignored, so the registry stays the scratch SQLite home', () => {
      // The runner sets this itself; asserted rather than assumed, because the
      // whole guard keys on it.
      expect(process.env.NODE_ENV).toBe('test');
      delete process.env.ARCHON_TEST_ALLOW_DATABASE_URL;
      process.env.DATABASE_URL = 'postgresql://operator-production:5432/remote_coding_agent';

      expect(getDatabaseType()).toBe('sqlite');
    });

    it('is honored when a test explicitly opts in', () => {
      process.env.ARCHON_TEST_ALLOW_DATABASE_URL = '1';
      process.env.DATABASE_URL = 'postgresql://localhost:5432/test';

      expect(getDatabaseType()).toBe('postgresql');
    });
  });
});
