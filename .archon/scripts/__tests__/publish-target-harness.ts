/**
 * Real `git init` checkouts for the two scripts that resolve a branch's repository.
 *
 * Both entry scripts wrap one shared resolver (`.shared/publish-target.ts`), and the
 * regression they exist for is a property of a CHECKOUT — a fork-style one, where
 * `origin` is the upstream and the fork is a second remote. So each case builds a real
 * repository with real remotes and real push configuration, and what is under test is
 * git's own push resolution rather than a model of it.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/** A pack script's path, from the pack-relative form the workflow node names. */
export function packScript(packRelativePath: string): string {
  return resolve(import.meta.dir, '../../workflows/sdlc', packRelativePath);
}

export function git(cwd: string, ...args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

export interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function run(script: string, cwd: string): Ran {
  const result = spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
  return { code: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * A repository on branch `work`, with whatever remotes and push config a case needs.
 * `trackTempRoot` is the caller's own `trackTempRoots()` handle, so each test file
 * keeps ownership of removing its own trees.
 */
export function checkout(
  trackTempRoot: (root: string) => string,
  setUp: (cwd: string) => void
): string {
  const cwd = trackTempRoot(mkdtempSync(join(tmpdir(), 'publish-target-')));
  git(cwd, 'init', '--initial-branch', 'work');
  git(cwd, 'config', 'user.email', 'test@example.invalid');
  git(cwd, 'config', 'user.name', 'Test');
  git(cwd, 'commit', '--allow-empty', '-qm', 'initial');
  setUp(cwd);
  return cwd;
}
