/**
 * The green gate: run success never certifies green — this does, deterministically.
 *
 * The delivery tail asks the question after implementation, after corrections, and
 * after the project's own full gate runs post-review. The same script answers it each
 * time. A node that produced a verdict is not a node that passed; the loop completes
 * on `done`, blocked declines included, so no spend and no public step happens until
 * this reads the verdict itself.
 *
 * Red is not one thing, though, and treating it as one killed two correct deliveries.
 * A change that breaks a check must never reach a pull request. A check that was
 * already red at the run's starting commit, or that failed because a parallel process
 * held the database this run needed, is not evidence about the change at all — and
 * reality gets checked again downstream regardless: flip-ready refuses to make the PR
 * ready while its real CI is not green. So this fails on `introduced` and lets
 * `inherited` and `environment` through with the claim recorded.
 *
 * Red the work order asked for is still red the change introduced, and it is refused
 * here with the rest. That is a decision, not an omission: this tail does not carry
 * red to a pull request, so there is no honest cause meaning "the failure is the
 * deliverable" — the only thing separating one from ordinary introduced red would be
 * a label the declaring agent wrote about its own work, and the same downstream CI
 * would refuse the flip anyway. What was missing was the tail saying so. The refusal
 * below names that reading and the routes that keep the finding: an expected-failure
 * marker, which pins it and re-runs it while the suite stays green, or a separate item
 * for a change only the operator may make. Triage refuses the shape before a run
 * spends on it (`sdlc/triage/commands/triage.md`); this is the backstop for a delivery
 * launched without one. See `.shared/verdict.ts` for the vocabulary's ownership.
 *
 * The record is this node's own result. Its node declares `output_type: green-gate`,
 * so the engine keeps the JSON below as a typed artifact under `nodes/`, one file per
 * gate, and every later reader — the pull-request body, the terminal report — finds
 * the passed reds by type. No shared file, so no gate ever overwrites or races
 * another's record.
 *
 * `green` and `red_cause` arrive certified: the producing node's `output_format`
 * declares the boolean and the enum, and the engine enforces both before the value
 * is bound here. The evidence behind the claim belongs to that node's prompt and
 * its report; this reads only that some evidence was given.
 *
 * Bound inputs (`with:` bindings, canonical text in env):
 * - INPUTS_GREEN: the declaring node's verdict, canonical boolean text.
 * - INPUTS_RED_CAUSE: the declared cause, or '' when the field was absent.
 * - INPUTS_SUMMARY: that node's summary, which carries the evidence for the claim.
 * - INPUTS_STAGE: which gate this is, for the record a human reads later.
 */

import { emit, note, refuse, trimmed } from '../../.shared/io.ts';
import { passesRed } from '../../.shared/verdict.ts';

const green = trimmed(process.env.INPUTS_GREEN);
const cause = trimmed(process.env.INPUTS_RED_CAUSE);
const summary = trimmed(process.env.INPUTS_SUMMARY);
const stage = trimmed(process.env.INPUTS_STAGE) || 'The work';

/**
 * Appended to every refusal that stops a red delivery, because the run that most
 * needs it is the one whose red was intended: without this, the refusal describes a
 * defect that is not there and the operator learns nothing about what to do instead.
 */
const DELIBERATE_RED =
  ' If this red is the deliverable — an assertion written to fail because the failure ' +
  'is the finding — the answer is the same, and this is the tail saying so: delivery ' +
  'never carries red to a pull request, so no red_cause means "the failure is the ' +
  'point". Keep the finding without a red suite: mark the assertion an expected ' +
  'failure, which leaves it pinned and re-run while the suite stays green, or raise ' +
  'the change only the operator may make as its own item. Then restate the work order ' +
  'before running delivery again.';

if (green === 'true') {
  emit({ gate: 'green', red_cause: '', stage, summary: '' });
} else if (cause === '') {
  refuse(
    `${stage} is red and declared no red_cause. Red that nobody explained is red this ` +
      'gate refuses — its summary says what happened.' +
      DELIBERATE_RED
  );
} else if (!passesRed(cause)) {
  refuse(
    `${stage} is red (${cause}). ` +
      (cause === 'interaction'
        ? `The separately green changes fail when composed; hold this combination. ${summary} `
        : 'The change has no accepted non-introduced-red evidence. ') +
      'Refusing to open or advance a pull request on red work.' +
      DELIBERATE_RED
  );
} else if (summary === '') {
  // The label is not the claim. A pass on non-introduced red is worth exactly the
  // evidence behind it — the failing check named, and why this change cannot have
  // caused it — and an empty summary carries none. Emptiness is all this checks;
  // whether the prose is genuine evidence is the declaring agent's judgment and the
  // reviewer's, never something to reconstruct from the text.
  refuse(
    `${stage} declared its red ${cause}, but recorded no evidence for the claim. ` +
      'A pass on red the change did not cause is only as good as the failing check ' +
      'it names — refusing without it.'
  );
} else {
  note(
    `${stage} is red, and declared that red ${cause} rather than introduced. ` +
      "Proceeding so the pull request's own CI can be observed; a red conclusion " +
      'requires explicit operator action.'
  );
  emit({ gate: 'green', red_cause: cause, stage, summary });
}
