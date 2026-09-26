/**
 * The `implement` pack's pull-request repository resolution, against real checkouts.
 *
 * The regression this exists for is a fork-style checkout — `origin` is the upstream and
 * the fork is a second remote — where the guard that proves this run's branch matches the
 * pull request it was pointed at read the pull request from `origin`, so it compared the
 * branch against an unrelated pull request in the upstream, or against none.
 *
 * The resolution is shared with the `pr` pack and resolve-publish-target.test.ts covers
 * it case by case. What is under test here is this entry's own contract, which differs on
 * purpose: an implement run needs a forge identity only when the work names a pull
 * request, so an unsettled checkout is REPORTED rather than refused, and the guard stops
 * the run on the empty value. Both fields are always present.
 */
import { describe, expect, it } from 'bun:test';
import { trackTempRoots } from '@archon/paths/test-utils';
import { checkout as initCheckout, git, packScript, run } from './publish-target-harness';

const SCRIPT = packScript('implement/scripts/resolve-pr-target.ts');

const trackTempRoot = trackTempRoots();

function checkout(setUp: (cwd: string) => void): string {
  return initCheckout(trackTempRoot, setUp);
}

function resolved(cwd: string): { repo: string; reason: string } {
  const ran = run(SCRIPT, cwd);
  expect({ code: ran.code, stderr: ran.stderr }).toEqual({ code: 0, stderr: '' });
  return JSON.parse(ran.stdout) as ReturnType<typeof resolved>;
}

/** The shape the regression lives in: `origin` is the upstream, `fork` is ours. */
function forkCheckout(...setUp: readonly ((cwd: string) => void)[]): string {
  return checkout(repo => {
    git(repo, 'remote', 'add', 'origin', 'https://github.com/upstream-owner/Archon.git');
    git(repo, 'remote', 'add', 'fork', 'https://github.com/fork-owner/Archon.git');
    for (const step of setUp) step(repo);
  });
}

describe('a fork-style checkout, where origin is the upstream', () => {
  it('names the fork the branch pushes to, not origin', () => {
    const cwd = forkCheckout(repo => { git(repo, 'config', 'remote.pushDefault', 'fork'); });

    expect(resolved(cwd)).toEqual({ repo: 'fork-owner/Archon', reason: '' });
  });

  it('resolves through the upstream a prior `git push -u` recorded', () => {
    const cwd = forkCheckout(repo => { git(repo, 'config', 'branch.work.remote', 'fork'); });

    expect(resolved(cwd)).toEqual({ repo: 'fork-owner/Archon', reason: '' });
  });

  it('resolves a lone remote, where there is no second candidate', () => {
    const cwd = checkout(repo => {
      git(repo, 'remote', 'add', 'fork', 'git@github.com:solo-owner/Archon.git');
    });

    expect(resolved(cwd)).toEqual({ repo: 'solo-owner/Archon', reason: '' });
  });
});

describe('a checkout that does not settle which repository the branch belongs to', () => {
  it('reports the reason instead of choosing, and never names the upstream', () => {
    const cwd = forkCheckout();

    const outcome = resolved(cwd);

    expect(outcome.repo).toBe('');
    expect(outcome.reason).toContain('(fork, origin)');
    expect(outcome.reason).toContain('remote.pushDefault');
    expect(outcome.reason).toContain('branch.work.pushRemote');
    // The failure that matters: it must not have silently picked the upstream.
    expect(outcome.reason).not.toContain('upstream-owner/Archon');
  });

  // An implement run that never touches the forge must still be able to work, so an
  // unsettled checkout is not a node failure here — it is an empty value the guard reads.
  it('still exits successfully, so work that needs no pull request can proceed', () => {
    const ran = run(SCRIPT, forkCheckout());

    expect(ran.code).toBe(0);
    expect(ran.stderr).toBe('');
  });

  it('reports a detached HEAD, which owns no branch to resolve', () => {
    const cwd = forkCheckout(repo => { git(repo, 'checkout', '--detach', '-q'); });

    const outcome = resolved(cwd);

    expect(outcome.repo).toBe('');
    expect(outcome.reason).toContain('detached');
  });
});

it('never carries a credential out of a credential-bearing remote', () => {
  const secret = 'ghp_exampletokenvalue';
  const cwd = checkout(repo => {
    git(repo, 'remote', 'add', 'fork', `https://x-access-token:${secret}@github.com/o/r.git`);
  });

  const ran = run(SCRIPT, cwd);

  expect(JSON.parse(ran.stdout)).toEqual({ repo: 'o/r', reason: '' });
  expect(ran.stdout).not.toContain(secret);
  expect(ran.stderr).not.toContain(secret);
});
