/**
 * Tests for `scripts/assert-deploy-on-dev.sh` — the guard that keeps `deploy` a
 * pointer at a commit `dev` already has.
 *
 * WHY AS A SUBPROCESS AGAINST REAL REPOSITORIES. What is under test is which
 * ref the script decides `dev` is and what it does when it cannot decide at all.
 * Stubbing git would test the stub. Each case builds a throwaway repository with
 * real commits and real refs, which is fast — these are empty commits.
 *
 * THE CASE WORTH MOST is "no dev ref anywhere": a guard that passes when it
 * cannot compare restores the exact hole it exists to close, and that failure
 * would look like success in every other test here.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trackTempRoots } from '@archon/paths/test-utils';

const trackTempRoot = trackTempRoots();

const SCRIPT = join(import.meta.dir, 'assert-deploy-on-dev.sh');

function git(cwd: string, ...args: string[]): string {
  const run = Bun.spawnSync(['git', ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'T',
      GIT_AUTHOR_EMAIL: 't@example.invalid',
      GIT_COMMITTER_NAME: 'T',
      GIT_COMMITTER_EMAIL: 't@example.invalid',
    },
  });
  if (run.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${run.stderr.toString()}`);
  }
  return run.stdout.toString().trim();
}

/** A repository with `n` commits on the checked-out branch, newest last. */
function repo(commits: string[]): { dir: string; shas: string[] } {
  const dir = trackTempRoot(mkdtempSync(join(tmpdir(), 'assert-dev-')));
  git(dir, 'init', '--quiet', '--initial-branch=work');
  const shas: string[] = [];
  for (const message of commits) {
    git(dir, 'commit', '--quiet', '--allow-empty', '-m', message);
    shas.push(git(dir, 'rev-parse', 'HEAD'));
  }
  return { dir, shas };
}

function run(
  dir: string,
  args: string[] = [],
  env: Record<string, string> = {}
): { code: number; out: string; err: string } {
  const result = Bun.spawnSync(['bash', SCRIPT, ...args], {
    cwd: dir,
    // REMOTE names a remote that does not exist, so the refresh fetch fails
    // instantly and offline. That is the documented non-fatal path, and every
    // case here exercises it.
    env: { ...process.env, REMOTE: 'fork', DEV_BRANCH: 'dev', ...env },
  });
  return {
    code: result.exitCode ?? -1,
    out: result.stdout.toString(),
    err: result.stderr.toString(),
  };
}

describe('assert-deploy-on-dev', () => {
  test('passes when the commit IS the tip of dev', () => {
    const { dir, shas } = repo(['one', 'two']);
    git(dir, 'update-ref', 'refs/remotes/fork/dev', shas[1]!);

    const result = run(dir);

    expect(result.code).toBe(0);
    expect(result.out).toContain('OK');
  });

  test('passes when the commit is BEHIND dev — an ancestor is already on dev', () => {
    const { dir, shas } = repo(['one', 'two', 'three']);
    git(dir, 'update-ref', 'refs/remotes/fork/dev', shas[2]!);

    const result = run(dir, [shas[0]!]);

    expect(result.code).toBe(0);
  });

  test('refuses a commit dev does not have, and names the offending commits', () => {
    const { dir, shas } = repo(['one', 'deploy-only-edit']);
    git(dir, 'update-ref', 'refs/remotes/fork/dev', shas[0]!);

    const result = run(dir);

    expect(result.code).toBe(1);
    expect(result.err).toContain('REFUSED');
    expect(result.err).toContain('1 commit(s)');
    expect(result.err).toContain('deploy-only-edit');
    expect(result.err).toContain('Open a PR');
  });

  test('refuses when dev cannot be resolved at all, rather than passing', () => {
    const { dir } = repo(['one']);

    const result = run(dir);

    expect(result.code).toBe(1);
    expect(result.err).toContain('cannot resolve dev');
    expect(result.out).not.toContain('OK');
  });

  test('falls back to a local dev branch when there is no remote-tracking ref', () => {
    const { dir, shas } = repo(['one']);
    git(dir, 'branch', 'dev', shas[0]!);

    const result = run(dir);

    expect(result.code).toBe(0);
    expect(result.out).toContain('refs/heads/dev');
  });

  test('prefers the remote-tracking ref over a stale local dev', () => {
    const { dir, shas } = repo(['one', 'two']);
    // Local dev is behind; the remote has the commit. Preferring the local ref
    // would refuse a commit dev genuinely has.
    git(dir, 'branch', 'dev', shas[0]!);
    git(dir, 'update-ref', 'refs/remotes/fork/dev', shas[1]!);

    const result = run(dir);

    expect(result.code).toBe(0);
    expect(result.out).toContain('refs/remotes/fork/dev');
  });

  test('refuses an argument that is not a commit', () => {
    const { dir, shas } = repo(['one']);
    git(dir, 'update-ref', 'refs/remotes/fork/dev', shas[0]!);

    const result = run(dir, ['no-such-ref']);

    expect(result.code).toBe(1);
    expect(result.err).toContain('not a commit');
  });

  test('defaults to HEAD when given no argument', () => {
    const { dir, shas } = repo(['one', 'two']);
    git(dir, 'update-ref', 'refs/remotes/fork/dev', shas[0]!);
    git(dir, 'checkout', '--quiet', shas[0]!);

    // HEAD is now the commit dev has, while the branch tip is not.
    expect(run(dir).code).toBe(0);
    expect(run(dir, ['work']).code).toBe(1);
  });

  test('honours DEV_BRANCH, so the branch name is not baked in', () => {
    const { dir, shas } = repo(['one', 'two']);
    git(dir, 'update-ref', 'refs/remotes/fork/trunk', shas[1]!);

    expect(run(dir, [], { DEV_BRANCH: 'trunk' }).code).toBe(0);
    expect(run(dir).code).toBe(1);
  });
});
