/**
 * The `pr` pack's publish-target resolution, against real checkouts.
 *
 * The regression this exists for is a fork-style checkout — `origin` is the upstream
 * and the fork is a second remote — where resolving the target from the name `origin`
 * publishes a completed delivery to a repository the operator never chose. That shape
 * is the first case below, and every other case here is a way the resolution could
 * quietly pick something instead of stopping.
 *
 * These cases cover the shared resolver (`.shared/publish-target.ts`) through this
 * pack's entry, which refuses when the checkout does not settle the target. The
 * `implement` entry wraps the same resolver with the other policy, and
 * resolve-pr-target.test.ts covers that difference.
 */
import { describe, expect, it } from 'bun:test';
import { trackTempRoots } from '@archon/paths/test-utils';
import {
  checkout as initCheckout,
  git,
  packScript,
  run as runScript,
  type Ran,
} from './publish-target-harness';

const SCRIPT = packScript('pr/scripts/resolve-publish-target.ts');

const trackTempRoot = trackTempRoots();

function checkout(setUp: (cwd: string) => void): string {
  return initCheckout(trackTempRoot, setUp);
}

function run(cwd: string): Ran {
  return runScript(SCRIPT, cwd);
}

function target(cwd: string): { host: string; path: string; remote: string; branch: string } {
  const resolved = run(cwd);
  expect({ code: resolved.code, stderr: resolved.stderr }).toEqual({ code: 0, stderr: '' });
  return JSON.parse(resolved.stdout) as ReturnType<typeof target>;
}

describe('a fork-style checkout, where origin is the upstream', () => {
  it('publishes to the fork the branch pushes to, not to origin', () => {
    const cwd = checkout(repo => {
      git(repo, 'remote', 'add', 'origin', 'https://github.com/upstream-owner/Archon.git');
      git(repo, 'remote', 'add', 'fork', 'https://github.com/fork-owner/Archon.git');
      git(repo, 'config', 'remote.pushDefault', 'fork');
    });

    expect(target(cwd)).toEqual({
      host: 'github.com',
      path: 'fork-owner/Archon',
      remote: 'fork',
      branch: 'work',
    });
  });

  it("prefers this branch's own push target over the checkout's default", () => {
    const cwd = checkout(repo => {
      git(repo, 'remote', 'add', 'origin', 'https://github.com/upstream-owner/Archon.git');
      git(repo, 'remote', 'add', 'fork', 'https://github.com/fork-owner/Archon.git');
      git(repo, 'remote', 'add', 'scratch', 'https://github.com/scratch-owner/Archon.git');
      git(repo, 'config', 'remote.pushDefault', 'fork');
      git(repo, 'config', 'branch.work.pushRemote', 'scratch');
    });

    expect(target(cwd).path).toBe('scratch-owner/Archon');
  });

  it('falls back to the upstream a prior `git push -u` recorded', () => {
    const cwd = checkout(repo => {
      git(repo, 'remote', 'add', 'origin', 'https://github.com/upstream-owner/Archon.git');
      git(repo, 'remote', 'add', 'fork', 'https://github.com/fork-owner/Archon.git');
      git(repo, 'config', 'branch.work.remote', 'fork');
    });

    expect(target(cwd).remote).toBe('fork');
  });
});

describe('a checkout that does not settle the target', () => {
  it('stops rather than choosing between remotes, and names how to settle it', () => {
    const cwd = checkout(repo => {
      git(repo, 'remote', 'add', 'origin', 'https://github.com/upstream-owner/Archon.git');
      git(repo, 'remote', 'add', 'fork', 'https://github.com/fork-owner/Archon.git');
    });

    const resolved = run(cwd);

    expect(resolved.code).not.toBe(0);
    expect(resolved.stdout.trim()).toBe('');
    expect(resolved.stderr).toContain('(fork, origin)');
    expect(resolved.stderr).toContain('remote.pushDefault');
    expect(resolved.stderr).toContain('branch.work.pushRemote');
    // The failure that matters: it must not have silently picked the upstream.
    expect(resolved.stderr).not.toContain('upstream-owner/Archon');
  });

  it('resolves a single remote, where there is no second candidate', () => {
    const cwd = checkout(repo => {
      git(repo, 'remote', 'add', 'origin', 'git@github.com:solo-owner/Archon.git');
    });

    expect(target(cwd)).toEqual({
      host: 'github.com',
      path: 'solo-owner/Archon',
      remote: 'origin',
      branch: 'work',
    });
  });

  it('stops when the push configuration names a remote the checkout does not have', () => {
    const cwd = checkout(repo => {
      git(repo, 'remote', 'add', 'origin', 'https://github.com/upstream-owner/Archon.git');
      git(repo, 'config', 'remote.pushDefault', 'removed-fork');
    });

    const resolved = run(cwd);

    expect(resolved.code).not.toBe(0);
    expect(resolved.stderr).toContain('removed-fork');
  });

  it('stops on a detached HEAD, which owns no branch to publish', () => {
    const cwd = checkout(repo => {
      git(repo, 'remote', 'add', 'origin', 'https://github.com/upstream-owner/Archon.git');
      git(repo, 'checkout', '--detach', '-q');
    });

    const resolved = run(cwd);

    expect(resolved.code).not.toBe(0);
    expect(resolved.stderr).toContain('detached');
  });

  it('stops on a remote that names no single repository, without echoing the URL', () => {
    const cwd = checkout(repo => {
      git(repo, 'remote', 'add', 'origin', 'https://github.com/owner-only');
    });

    const resolved = run(cwd);

    expect(resolved.code).not.toBe(0);
    expect(resolved.stdout.trim()).toBe('');
    expect(resolved.stderr).toContain("remote 'origin'");
    expect(resolved.stderr).not.toContain('owner-only');
  });
});

describe('the remote URL forms a target can arrive in', () => {
  it("reads the remote's push URL when it differs from its fetch URL", () => {
    const cwd = checkout(repo => {
      git(repo, 'remote', 'add', 'origin', 'https://github.com/upstream-owner/Archon.git');
      git(repo, 'remote', 'set-url', '--push', 'origin', 'git@github.com:fork-owner/Archon.git');
    });

    expect(target(cwd).path).toBe('fork-owner/Archon');
  });

  it("normalizes GitHub's alternate SSH host to the forge host", () => {
    const cwd = checkout(repo => {
      git(repo, 'remote', 'add', 'origin', 'ssh://git@ssh.github.com/fork-owner/Archon.git');
    });

    expect(target(cwd)).toMatchObject({ host: 'github.com', path: 'fork-owner/Archon' });
  });

  it('never carries a credential out of a credential-bearing remote', () => {
    const secret = 'ghp_exampletokenvalue';
    const cwd = checkout(repo => {
      git(repo, 'remote', 'add', 'origin', `https://x-access-token:${secret}@github.com/o/r.git`);
    });

    const resolved = run(cwd);

    expect(resolved.code).toBe(0);
    expect(JSON.parse(resolved.stdout)).toMatchObject({ host: 'github.com', path: 'o/r' });
    expect(resolved.stdout).not.toContain(secret);
    expect(resolved.stderr).not.toContain(secret);
  });

  it('drops an explicit port without losing the host', () => {
    const cwd = checkout(repo => {
      git(repo, 'remote', 'add', 'origin', 'ssh://git@git.example.com:2222/team/service.git');
    });

    expect(target(cwd)).toMatchObject({ host: 'git.example.com', path: 'team/service' });
  });
});
