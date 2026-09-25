/**
 * Route a delivery that cannot honestly flip ready to an explicit operator action.
 *
 * Two conditions arrive here, and neither is work this run can do:
 *
 * - late CI red the change did not introduce (`inherited` or `environment`), which
 *   needs the failing check re-run; and
 * - a check state that could not be read at all (`unreadable`), which needs whatever
 *   blocked the read cleared.
 *
 * Both are the operator's to clear, so both pause rather than fail, and each carries
 * the sentence that says what clearing it means. `reason` and `action` are display
 * text for the wait's attention message — nothing parses them, and the `attention`
 * boolean is what the DAG branches on.
 *
 * The unreadable case is checked first because it dominates: when no state was read,
 * no red was classified, and any cause bound alongside it describes an earlier round
 * rather than the condition holding the run.
 *
 * Bound inputs (`with:` bindings, canonical text in env):
 * - INPUTS_RED_CAUSE: the correction pass's declared cause, or '' when it was skipped.
 * - INPUTS_CI_STATE: the CI verdict's certified state.
 */

import { emit, trimmed } from '../../.shared/io.ts';
import { passesRed } from '../../.shared/verdict.ts';

const redCause = trimmed(process.env.INPUTS_RED_CAUSE);
const state = trimmed(process.env.INPUTS_CI_STATE);

if (state === 'unreadable') {
  emit({
    attention: true,
    red_cause: redCause,
    reason: "Archon could not read this pull request's check state",
    action:
      'Clear what blocked the read — a token scope, a repository setting, or a ' +
      'forge outage — then resume this run. Nothing flips ready on a check that ' +
      'was never read.',
  });
} else if (passesRed(redCause)) {
  emit({
    attention: true,
    red_cause: redCause,
    reason: `CI remains non-green after Archon classified the failure as ${redCause}`,
    action: 'Re-run the failing check, then resume this run.',
  });
} else {
  emit({ attention: false, red_cause: redCause, reason: '', action: '' });
}
