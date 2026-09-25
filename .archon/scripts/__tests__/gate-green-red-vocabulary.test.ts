/**
 * The green gate's red vocabulary, pinned end to end.
 *
 * `red_cause` has a term for red that a work order asked for — `deliberate`, an
 * assertion written to fail because the failure is the finding — and that term does
 * not pass the gate. Both halves are the decision (see `sdlc/.shared/verdict.ts`), and
 * it only holds if both stay true: a self-declared `deliberate` never reaches a pull
 * request, and the refusal answers what was declared instead of describing a defect
 * that is not there.
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
    // The shape a new cause would arrive in. It must not reach a pull request on the
    // strength of being spelled, however plausible the label.
    const verdict = gate({
      green: 'false',
      red_cause: 'sanctioned',
      summary: 'stub: a label nothing in this pack declares',
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
  /** The run in rajababa-io/Archon#34, declared in the vocabulary it now has. */
  const summary =
    'stub: the new assertion fails because a capability literal disagrees with its ' +
    'documented intent; correcting the literal widens a security gate and is the ' +
    "operator's call";
  const deliberate = gate({ green: 'false', red_cause: 'deliberate', summary });

  it('refuses, because no cause carries red to a pull request', () => {
    expect(deliberate.code).toBe(1);
    expect(deliberate.stdout.trim()).toBe('');
  });

  it('answers the claim that was made instead of asserting a defect', () => {
    expect(deliberate.stderr).toContain('red on purpose');
    expect(deliberate.stderr).toContain('the failing assertion is the deliverable');
    // The introduced-red refusal's wording would be a false diagnosis here.
    expect(deliberate.stderr).not.toContain('no accepted non-introduced-red evidence');
  });

  it("carries the declaration's own evidence into the refusal", () => {
    expect(deliberate.stderr).toContain('widens a security gate');
  });

  it('names the routes that keep the finding without a red suite', () => {
    expect(deliberate.stderr).toContain('expected failure');
    expect(deliberate.stderr).toContain('its own item');
    expect(deliberate.stderr).toContain('restate the work order');
  });

  it('refuses before green is read, so a contradictory verdict cannot pass', () => {
    // `green: true` with an intended red contradicts itself; neither half is actionable.
    const contradictory = gate({ green: 'true', red_cause: 'deliberate', summary });

    expect(contradictory.code).toBe(1);
    expect(contradictory.stderr).toContain('red on purpose');
  });

  it('leaves the ordinary introduced-red refusal free of deliberate-red advice', () => {
    // The Route B mechanism this replaced appended that advice to every red refusal,
    // which told a run that genuinely broke a check to consider an expected-failure
    // marker. A real break must never read as a candidate for one.
    const broke = gate({
      green: 'false',
      red_cause: 'introduced',
      summary: 'stub: the change broke two tests',
    });

    expect(broke.code).toBe(1);
    expect(broke.stderr).toContain('Refusing to open or advance a pull request on red work');
    expect(broke.stderr).not.toContain('expected failure');
    expect(broke.stderr).not.toContain('red on purpose');
  });
});
