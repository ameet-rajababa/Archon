import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { forgeResponse, PACK, runDeliverScript, type ForgeFake } from './deliver-checks-harness';

const probe = runDeliverScript.bind(null, 'check-ci');

describe('check-ci on the default gh source', () => {
  it('reads the recorded qualified PR through gh and never calls the forge CLI', () => {
    const result = probe({
      gh: {
        checks: [
          { name: 'build', state: 'SUCCESS', bucket: 'pass' },
          { name: 'docs', state: 'SKIPPED', bucket: 'skipping' },
        ],
      },
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      state: 'concluded',
      detail: 'all 2 observed check(s) green; skipped (non-blocking): docs',
    });
    expect(result.gh[0]).toBe('pr checks 42 --repo ghe.example.com/example/repo --json name,state');
    expect(result.forge).toEqual([]);
  });

  it('keeps a running check pending even when another already failed', () => {
    const result = probe({
      gh: {
        checks: [
          { name: 'lint', state: 'FAILURE', bucket: 'fail' },
          { name: 'test', state: 'IN_PROGRESS', bucket: 'pending' },
        ],
      },
    });
    expect(JSON.parse(result.stdout)).toEqual({ state: 'pending', detail: '1 check(s) running' });
  });

  // gh buckets STALE and STARTUP_FAILURE as pending and anything it does not
  // know as pending too, so the reader classifies gh's raw state, not its bucket.
  it('names failed, cancelled, stale, startup-failed and unrecognized checks as red', () => {
    const result = probe({
      gh: {
        checks: [
          { name: 'lint', state: 'FAILURE', bucket: 'fail' },
          { name: 'e2e', state: 'CANCELLED', bucket: 'cancel' },
          { name: 'old', state: 'STALE', bucket: 'pending' },
          { name: 'boot', state: 'STARTUP_FAILURE', bucket: 'pending' },
          { name: 'odd', state: 'SOMETHING_NEW', bucket: 'pending' },
        ],
      },
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      state: 'red',
      detail:
        'non-green checks: lint (failure), e2e (cancelled), old (stale), boot (startup_failure); ' +
        'checks have unknown state: odd (something_new)',
    });
  });

  // gh buckets ACTION_REQUIRED as fail; it is a maintainer's approval gate, not a broken branch.
  it('reports a check awaiting maintainer approval as gated, not red', () => {
    const result = probe({
      gh: {
        checks: [
          { name: 'build', state: 'SUCCESS', bucket: 'pass' },
          { name: 'deploy', state: 'ACTION_REQUIRED', bucket: 'fail' },
        ],
      },
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      state: 'concluded',
      detail: 'checks gated: deploy (action_required)',
    });
  });

  it('declares a failed read unreadable instead of concluding there is no CI', () => {
    // The invariant this has always protected is unchanged: a failed observation is
    // never evidence that no CI exists. What changed is who owns the condition. It
    // used to refuse, which fails the loop group and the whole run — discarding a
    // complete, validated, reviewed pull request over a token scope. It now declares
    // its own state, and the tail routes that to the operator (#33).
    const result = probe({ gh: { checks: 'fail', rollup: 'fail', workflows: 0 } });
    expect(result.code).toBe(0);
    const declared = JSON.parse(result.stdout) as { state: string; detail: string };
    expect(declared.state).toBe('unreadable');
    expect(declared.state).not.toBe('concluded');
    expect(declared.detail).toContain('could not read check state: HTTP 502');
  });

  it('declares a payload it cannot classify unreadable, and never green', () => {
    const result = probe({ gh: { checks: 'garbage', rollup: 'fail', workflows: 0 } });
    expect(result.code).toBe(0);
    const declared = JSON.parse(result.stdout) as { state: string; detail: string };
    expect(declared.state).toBe('unreadable');
    expect(declared.detail).toContain('unexpected check payload shape');
  });

  it('still refuses a misconfigured run rather than calling it unreadable', () => {
    // A wiring defect is the operator's, not the forge's condition, and it must not
    // be smuggled into the state that pauses for a token scope. CheckReadError is
    // what separates them — never the wording of the failure.
    const result = probe({ gh: {}, inputs: { INPUTS_PR: 'not-json' } });
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('check-ci:');
  });

  it('concludes without the grace wait when the repository has no active workflow', () => {
    const result = probe({ gh: { rollup: 0, workflows: 0 } });
    expect(JSON.parse(result.stdout)).toEqual({
      state: 'concluded',
      detail: 'no checks configured on this repository — nothing to await',
    });
    expect(result.gh).toContain(
      'api --hostname ghe.example.com repos/example/repo/actions/workflows --paginate --jq .workflows[] | select(.state == "active") | .id'
    );
  });

  it('gives configured CI one registration grace read, then names the maintainer gate', () => {
    const result = probe({ gh: { rollup: 0, workflows: 2 } });
    expect(JSON.parse(result.stdout).state).toBe('concluded');
    expect(result.stdout).toContain("awaiting a maintainer's approval");
    expect(result.gh.filter(call => call.startsWith('pr checks'))).toHaveLength(2);
  });

  it('refuses an unrecognized check source instead of guessing one', () => {
    const result = probe({ source: 'gitlab', gh: { checks: [{ name: 'b', state: 'SUCCESS', bucket: 'pass' }] } });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ARCHON_SDLC_FORGE must be "gh" (the default) or "forge"');
    expect(result.gh).toEqual([]);
  });
});

describe('check-ci on the opt-in forge source', () => {
  const forge = (response: string | string[]): ForgeFake => ({ kind: 'fake', response });

  it('classifies external-status-only observations and keeps the evaluated revision', () => {
    const result = probe({
      source: 'forge',
      forge: forge(forgeResponse([{ name: 'external/status', state: 'red' }])),
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      state: 'red',
      detail: 'non-green checks at deadbeef: external/status (failure)',
    });
    expect(result.forge[0]).toContain('forge checks --json --data');
    expect(result.forge[0]).toContain('ghe.example.com');
    expect(result.gh).toEqual([]);
  });

  it('prefers the required set when the plugin reports one', () => {
    const result = probe({
      source: 'forge',
      forge: forge(
        forgeResponse([{ name: 'optional', state: 'red' }], {
          required: [{ name: 'required', state: 'green' }],
        })
      ),
    });
    expect(JSON.parse(result.stdout)).toEqual({
      state: 'concluded',
      detail: 'all 1 observed check(s) green at deadbeef',
    });
  });

  it('keeps gated explicit without calling it green', () => {
    const result = probe({ source: 'forge', forge: forge(forgeResponse([{ name: 'build', state: 'gated' }])) });
    expect(JSON.parse(result.stdout)).toEqual({
      state: 'concluded',
      detail: 'checks gated at deadbeef: build (failure)',
    });
  });

  it('gives an empty observation one grace read without the Actions probe', () => {
    const result = probe({
      source: 'forge',
      forge: forge([
        forgeResponse([], { revision: 'first' }),
        forgeResponse([{ name: 'build', state: 'green' }], { revision: 'second' }),
      ]),
    });
    expect(JSON.parse(result.stdout)).toEqual({
      state: 'concluded',
      detail: 'all 1 observed check(s) green at second',
    });
    expect(result.forge).toHaveLength(2);
    expect(result.gh).toEqual([]);
  });

  it('fails loudly when forge is selected but the host published no CLI command', () => {
    const result = probe({ source: 'forge', forge: { kind: 'no-host' } });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ARCHON_SDLC_FORGE=forge: ARCHON_CLI_COMMAND is not set');
    expect(result.gh).toEqual([]);
  });

  it('fails loudly when forge is selected but no plugin is installed', () => {
    const result = probe({ source: 'forge', forge: { kind: 'no-plugin' } });
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'check-ci: ARCHON_SDLC_FORGE=forge: forge check read failed: no forge plugin claims ghe.example.com'
    );
    expect(result.gh).toEqual([]);
  });
});

describe('ci-attention-route', () => {
  const route = (
    env: Record<string, string>
  ): {
    code: number;
    declared: { attention: boolean; red_cause: string; reason: string; action: string };
  } => {
    const result = Bun.spawnSync(
      [process.execPath, join(PACK, 'deliver/scripts/ci-attention-route.ts')],
      { env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' }
    );
    return {
      code: result.exitCode,
      declared: JSON.parse(result.stdout.toString()) as {
        attention: boolean;
        red_cause: string;
        reason: string;
        action: string;
      },
    };
  };

  it('routes an unreadable state to an operator action naming the read', () => {
    const { code, declared } = route({ INPUTS_CI_STATE: 'unreadable', INPUTS_RED_CAUSE: '' });

    expect(code).toBe(0);
    expect(declared.attention).toBe(true);
    expect(declared.reason).toContain('could not read');
    expect(declared.action).toContain('resume this run');
  });

  it('keeps routing non-introduced red to its own rerun action', () => {
    const { declared } = route({ INPUTS_CI_STATE: 'red', INPUTS_RED_CAUSE: 'inherited' });

    expect(declared.attention).toBe(true);
    expect(declared.red_cause).toBe('inherited');
    expect(declared.action).toContain('Re-run the failing check');
  });

  it('does not route red the change introduced', () => {
    expect(route({ INPUTS_CI_STATE: 'red', INPUTS_RED_CAUSE: 'introduced' }).declared.attention).toBe(
      false
    );
  });
});
