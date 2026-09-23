/**
 * The green gate's red vocabulary, pinned end to end.
 *
 * `red_cause` has no term for red that a work order asked for — an assertion written
 * to fail because the failure is the finding. That is a decision (see
 * `sdlc/.shared/verdict.ts`), and a decision only holds if two things stay true:
 * the refusal says so instead of describing a defect that is not there, and a cause
 * cannot be added later by editing an enum.
 *
 * So this walks the whole declared vocabulary against the real script rather than
 * asserting three cases by hand. A member added to `VALIDATION_RED_CAUSES` without a
 * decision in `PASSES_RED` refuses here by construction, and any member that does pass
 * must still refuse on a bare declaration — the existing summary-evidence rule is the
 * floor a new cause has to clear.
 */
import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { VALIDATION_RED_CAUSES } from '../../workflows/sdlc/.shared/composition.ts';
import { PASSES_RED, passesRed } from '../../workflows/sdlc/.shared/verdict.ts';

const GATE = resolve(import.meta.dir, '../../workflows/sdlc/deliver/scripts/gate-green.ts');

interface Verdict {
  code: number;
  stdout: string;
  stderr: string;
}

function gate(inputs: {
  green: string;
  red_cause: string;
  summary: string;
  stage?: string;
}): Verdict {
  const result = spawnSync(process.execPath, [GATE], {
    env: {
      ...process.env,
      INPUTS_GREEN: inputs.green,
      INPUTS_RED_CAUSE: inputs.red_cause,
      INPUTS_SUMMARY: inputs.summary,
      INPUTS_STAGE: inputs.stage ?? 'The implementation',
    },
    encoding: 'utf8',
  });
  return { code: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Every cause a producing node can declare. '' is "not declared", judged separately. */
const DECLARED_RED_CAUSES = VALIDATION_RED_CAUSES.filter(cause => cause !== '');

describe('the causes the green gate accepts on red', () => {
  it('accepts exactly the causes the change cannot have introduced', () => {
    for (const cause of DECLARED_RED_CAUSES) {
      const verdict = gate({ green: 'false', red_cause: cause, summary: 'stub: evidence named' });
      expect({ cause, passed: verdict.code === 0 }).toEqual({ cause, passed: passesRed(cause) });
    }
  });

  it('refuses a cause it has never been taught, rather than passing an unknown one', () => {
    // The shape a fifth cause would arrive in. It must not reach a pull request on the
    // strength of being spelled, however plausible the label.
    const verdict = gate({
      green: 'false',
      red_cause: 'deliberate',
      summary: 'stub: the failing assertion is the deliverable, as the work order asked',
    });

    expect(verdict.code).not.toBe(0);
    expect(verdict.stdout.trim()).toBe('');
  });

  it('refuses every accepted cause on a bare declaration with no evidence', () => {
    for (const cause of PASSES_RED) {
      const verdict = gate({ green: 'false', red_cause: cause, summary: '' });

      expect({ cause, passed: verdict.code === 0 }).toEqual({ cause, passed: false });
      expect(verdict.stderr).toContain('recorded no evidence');
    }
  });

  it('still certifies green, and still refuses red nobody explained', () => {
    expect(gate({ green: 'true', red_cause: '', summary: '' }).code).toBe(0);
    expect(gate({ green: 'false', red_cause: '', summary: 'stub: something broke' }).code).toBe(1);
  });
});

describe('the refusal a deliberately-red delivery receives', () => {
  /** The run in rajababa-io/Archon#34: the implementation declared its red truthfully. */
  const deliberate = gate({
    green: 'false',
    red_cause: 'introduced',
    summary:
      'stub: the new assertion fails because a capability literal disagrees with its ' +
      'documented intent; correcting the literal widens a security gate and is the ' +
      "operator's call",
  });

  it('still refuses, on the same evidence rules as any introduced red', () => {
    expect(deliberate.code).toBe(1);
    expect(deliberate.stdout.trim()).toBe('');
    expect(deliberate.stderr).toContain('Refusing to open or advance a pull request on red work');
  });

  it('names the intended-red reading instead of asserting a defect that is not there', () => {
    expect(deliberate.stderr).toContain('If this red is the deliverable');
    expect(deliberate.stderr).toContain('never carries red to a pull request');
  });

  it('names the routes that keep the finding without a red suite', () => {
    expect(deliberate.stderr).toContain('expected failure');
    expect(deliberate.stderr).toContain('its own item');
    expect(deliberate.stderr).toContain('restate the work order');
  });

  it('says the same thing when the red was declared with no cause at all', () => {
    const undeclared = gate({ green: 'false', red_cause: '', summary: 'stub: one check fails' });

    expect(undeclared.code).toBe(1);
    expect(undeclared.stderr).toContain('If this red is the deliverable');
  });
});
