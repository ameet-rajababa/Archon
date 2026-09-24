/**
 * The deliver probe's "does this repository have CI at all" read.
 *
 * `repoHasActiveWorkflows()` asked `gh` to slurp and filter in one call. gh refuses
 * that combination, so the read failed on every repository, the function always
 * returned its fail-safe, and the branch it exists for was dead code no test could have
 * been exercising against a real `gh`. Every delivery against a CI-less repository paid
 * a 60 s registration grace and then reported a maintainer gate that was not there.
 *
 * These tests run the real script against a fake `gh` that records its own argv, so
 * both halves are covered: what the script asks for, and what it concludes from the
 * answer. The argv trace is what would have caught the original defect — a read shaped
 * the way gh rejects it.
 *
 * The no-CI branch is the cheap one to observe: it emits immediately. Every other
 * answer means "configured", whose only observable is the 60 s grace, so those cases
 * assert the script is *still running* after a short timeout rather than waiting it
 * out. Not concluding is exactly the property under test there.
 */
import { describe, expect, it } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { trackTempRoots } from '@archon/paths/test-utils';

const SCRIPT = resolve(
  import.meta.dir,
  '../../workflows/sdlc/deliver/scripts/check-ci.ts'
);
const PR_URL = 'https://github.com/recorded-owner/recorded-repo/pull/42';
const REPO_PATH = 'recorded-owner/recorded-repo';

/** Long enough to prove the script did not conclude, far short of the 60 s grace. */
const NOT_CONCLUDING_MS = 4000;

const trackTempRoot = trackTempRoots();

interface FakeGh {
  /** stdout for `gh api .../actions/workflows`; omit to make that read fail. */
  workflowsOut?: string;
  /** Overrides the recorded repository bound to the script. */
  repoPath?: string;
  /** Milliseconds to allow before giving up on the script concluding. */
  timeout?: number;
}

interface Probe {
  code: number;
  stdout: string;
  stderr: string;
  /** Every `gh` invocation the script made, in order, one argv per line. */
  calls: string[];
  timedOut: boolean;
}

/**
 * A repository whose pull request has no checks and never registers any, so the probe
 * reaches the workflows read on its first pass. What that read answers is the variable.
 */
function runProbe(gh: FakeGh): Probe {
  const root = trackTempRoot(mkdtempSync(join(tmpdir(), 'check-ci-workflows-')));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const trace = join(root, 'gh-calls');

  const ghScript = `#!/bin/sh
printf '%s\\n' "$*" >> '${trace}'
case "$*" in
  *'pr checks'*) printf '%s' 'no checks reported'; exit 0 ;;
  *statusCheckRollup*) printf '%s' '0'; exit 0 ;;
  *actions/workflows*)
    if [ -n '${gh.workflowsOut ?? ''}' ]; then printf '%s' '${gh.workflowsOut ?? ''}'; exit 0; fi
    echo "fake gh: workflows read denied" >&2
    exit 1
    ;;
esac
echo "fake gh: unexpected args: $*" >&2
exit 1
`;
  writeFileSync(join(bin, 'gh'), ghScript);
  chmodSync(join(bin, 'gh'), 0o755);

  const result = spawnSync(process.execPath, [SCRIPT], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      INPUTS_PR_URL: PR_URL,
      INPUTS_REPO_PATH: gh.repoPath ?? REPO_PATH,
    },
    encoding: 'utf8',
    timeout: gh.timeout,
  });

  let calls: string[] = [];
  try {
    calls = readFileSync(trace, 'utf8').split('\n').filter(line => line !== '');
  } catch {
    calls = [];
  }

  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    calls,
    timedOut: result.signal !== null,
  };
}

/** One page of the `actions/workflows` listing, as gh's `--slurp` returns it. */
function page(...states: string[]): Record<string, unknown> {
  return {
    total_count: states.length,
    workflows: states.map((state, index) => ({ id: index, name: `w${index}`, state })),
  };
}

describe('the read that asks whether a repository has CI', () => {
  it('does not ask gh to slurp and filter in one call, which gh refuses', () => {
    const probe = runProbe({ workflowsOut: JSON.stringify([page()]) });
    const workflowsCall = probe.calls.find(call => call.includes('actions/workflows'));

    expect(workflowsCall).toBeDefined();
    expect(workflowsCall).toContain('--slurp');
    // The original defect, in one assertion: gh rejects --slurp together with --jq, so
    // the call always failed and the branch below was unreachable.
    expect(workflowsCall).not.toContain('--jq');
  });

  it("names the pull request's own repository instead of letting gh resolve one", () => {
    const probe = runProbe({ workflowsOut: JSON.stringify([page()]) });
    const workflowsCall = probe.calls.find(call => call.includes('actions/workflows'));

    expect(workflowsCall).toContain(`repos/${REPO_PATH}/actions/workflows`);
    // gh's own placeholder resolution reads the checkout's remotes, which is the
    // upstream in a fork checkout — a different repository's answer.
    expect(workflowsCall).not.toContain('{owner}');
  });

  it('refuses a recorded repository that is not an owner/repo', () => {
    const probe = runProbe({ repoPath: 'not a repo', workflowsOut: JSON.stringify([page()]) });

    expect(probe.code).not.toBe(0);
    expect(probe.stdout.trim()).toBe('');
    expect(probe.stderr).toContain('not an owner/repo');
    expect(probe.calls).toEqual([]);
  });
});

describe('a repository with no CI', () => {
  it('concludes immediately instead of paying the registration grace', () => {
    const started = Date.now();
    const probe = runProbe({ workflowsOut: JSON.stringify([page()]) });
    const elapsed = Date.now() - started;

    expect(probe.code).toBe(0);
    const declared = JSON.parse(probe.stdout) as { state: string; detail: string };
    expect(declared.state).toBe('concluded');
    expect(declared.detail).toContain('no checks configured');
    // The grace is 60 s. This branch was unreachable before, so every CI-less delivery
    // paid it and then reported a maintainer gate that did not exist.
    expect(elapsed).toBeLessThan(NOT_CONCLUDING_MS);
    // One pass: nothing re-read the checks, because nothing waited.
    expect(probe.calls.filter(call => call.includes('pr checks'))).toHaveLength(1);
  });

  it('counts only active workflows, so a fully disabled repository is CI-less', () => {
    const probe = runProbe({
      workflowsOut: JSON.stringify([page('disabled_manually', 'disabled_inactivity')]),
    });

    expect(probe.code).toBe(0);
    expect((JSON.parse(probe.stdout) as { state: string }).state).toBe('concluded');
  });
});

describe('everything that is not a proven absence of CI', () => {
  it('waits when an active workflow appears only on a later page', () => {
    // Pagination is why this read slurps at all: a first page of disabled workflows is
    // not an answer about the repository.
    const probe = runProbe({
      workflowsOut: JSON.stringify([page('disabled_manually'), page('active')]),
      timeout: NOT_CONCLUDING_MS,
    });

    expect(probe.timedOut).toBe(true);
    expect(probe.stdout.trim()).toBe('');
  });

  it('waits when the workflows read fails, so a failed read still counts as configured', () => {
    const probe = runProbe({ timeout: NOT_CONCLUDING_MS });

    expect(probe.timedOut).toBe(true);
    expect(probe.stdout.trim()).toBe('');
  });

  it('waits when the payload is a shape it cannot count', () => {
    const probe = runProbe({
      workflowsOut: '[{"total_count":1,"workflows":"not-an-array"}]',
      timeout: NOT_CONCLUDING_MS,
    });

    expect(probe.timedOut).toBe(true);
    expect(probe.stdout.trim()).toBe('');
  });
});
