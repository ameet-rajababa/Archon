import { describe, expect, test } from 'bun:test';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trackTempRoots } from '@archon/paths/test-utils';
import { toWorktreePath } from './types';
import { refreshWorktreeIndex } from './worktree';

const trackTempRoot = trackTempRoots();

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

/**
 * This test's own budget, rather than the 20 s Windows default from
 * scripts/bun-test-command.ts.
 *
 * It writes 200 files and issues five `git` spawns, and the default is attributed
 * (coleam00/Archon#3294) as a runner floor and not headroom: on the 4-vCPU
 * `windows-latest` VM any spawn issued while the suite saturates the CPUs and the disk
 * takes 5 to 15 s regardless of which test issued it. Measured green at 8127 ms on
 * windows-latest and it timed out at 20754 ms on a re-run of the same commit — a single
 * unlucky spawn is the whole difference, so 20 s was never a budget for this test.
 *
 * Sized as a ceiling on a hung test rather than as a budget: five spawns each able to
 * absorb the attributed residual, on top of the measured 8 s. Nothing here sleeps, so a
 * healthy run still finishes in its measured time, and Linux measured under a second.
 */
const WORKTREE_INDEX_TIMEOUT_MS = 120_000;

describe('refreshWorktreeIndex', () => {
  test(
    'leaves no tracked file racily clean in a worktree just created',
    async () => {
      const root = trackTempRoot(mkdtempSync(join(tmpdir(), 'refresh-worktree-index-')));
      const repo = join(root, 'repo');
      git(root, 'init', '-q', '-b', 'main', repo);
      for (let i = 0; i < 200; i++) writeFileSync(join(repo, `f${i}.txt`), `${i}\n`);
      git(repo, 'add', '-A');
      git(repo, '-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-q', '-m', 'files');
      const worktree = join(root, 'worktree');
      git(repo, 'worktree', 'add', '-q', worktree);

      await refreshWorktreeIndex(toWorktreePath(worktree));

      // Git compares whole seconds: an entry whose file second is not older than the
      // index file's second is racily clean and re-hashed by every read-only status.
      const index = git(worktree, 'rev-parse', '--path-format=absolute', '--git-path', 'index');
      const indexSecond = Math.floor(statSync(index).mtimeMs / 1000);
      const fileSeconds = [...git(worktree, 'ls-files', '--debug').matchAll(/mtime: (\d+):/g)].map(
        match => Number(match[1])
      );
      expect(fileSeconds).toHaveLength(200);
      expect(fileSeconds.filter(second => second >= indexSecond)).toEqual([]);
    },
    WORKTREE_INDEX_TIMEOUT_MS
  );
});
