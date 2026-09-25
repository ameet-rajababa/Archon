/**
 * The one judgment this pack makes about a red gate: whether the declared cause is
 * one the change cannot have introduced.
 *
 * The vocabulary itself (`introduced`, `inherited`, `environment`, `interaction`,
 * `incomplete`, `deliberate`, or the empty string for "not declared") is an enum on the
 * producing nodes' `output_format`, where the engine certifies it. Nothing here
 * re-checks membership: a value that reaches a script through a `with:` binding already
 * passed that gate.
 *
 * Two of those causes fail without being introduced red, and neither belongs in
 * `PASSES_RED`. `incomplete` is no verdict at all. `deliberate` is a verdict, and a
 * true one — the failing assertion is what the work order asked for — but delivery
 * still refuses it, because what separates a self-declared `deliberate` from ordinary
 * `introduced` red is a label the implementing agent wrote about its own work. It
 * earns its place by being sayable, not by passing: the implementer gets to state
 * what it did, and the refusal answers that instead of reporting a defect that is
 * not there.
 */

export const PASSES_RED = ['inherited', 'environment'] as const;

/** Red that the change did not cause: the base was already red, or the environment was. */
export function passesRed(cause: string): boolean {
  return (PASSES_RED as readonly string[]).includes(cause);
}

/**
 * The refusal for a verdict declared `incomplete`: some checks never ran and none that
 * ran failed. It is not red, so it never says so — a reader sent hunting for a failure
 * that does not exist loses the real action, which is to let validation finish. Every
 * gate that reads a verdict refuses this cause with this one message.
 */
export function unfinishedValidation(stage: string, summary: string): string {
  return (
    `${stage}: validation didn't finish. Not every check ran, and none that ran ` +
    `failed.${summary === '' ? '' : ` ${summary}`} Resume the run once whatever ` +
    'stopped it is cleared, so validation can finish. An unfinished validation ' +
    'never passes this gate.'
  );
}

/**
 * The refusal for a verdict declared `deliberate`: the change is red on purpose,
 * because a failing assertion is the finding the work order asked for.
 *
 * The claim is accepted as true and still refused. Delivery does not carry red to a
 * pull request — `flip-ready` would refuse the flip on the pull request's own CI
 * regardless — so the run ends here either way. What changes is what the operator
 * reads: not "the change has no accepted evidence", which describes a defect that is
 * not there, but the two routes that keep the finding without a red suite. An
 * expected-failure marker keeps it pinned and re-run while the suite stays green; a
 * change only the operator may make belongs in its own item.
 *
 * Triage is meant to catch this shape before a run spends on it. This is the backstop
 * for a delivery launched without one, which is the run this cause was written for.
 */
export function deliberateRed(stage: string, summary: string): string {
  return (
    `${stage} is red on purpose: the failing assertion is the deliverable.${
      summary === '' ? '' : ` ${summary}`
    } That is taken as stated, and delivery still refuses it — this tail never carries ` +
    'red to a pull request, and the pull request would be red on arrival. Keep the ' +
    'finding without a red suite: mark the assertion an expected failure, which leaves ' +
    'it pinned and re-run while the suite stays green, or raise the change only the ' +
    'operator may make as its own item. Then restate the work order before running ' +
    'delivery again.'
  );
}
