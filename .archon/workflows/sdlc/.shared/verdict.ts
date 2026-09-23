/**
 * The one judgment this pack makes about a red gate: whether the declared cause is
 * one the change cannot have introduced.
 *
 * The vocabulary itself (`introduced`, `inherited`, `environment`, or the empty
 * string for "not declared") is an enum on the producing nodes' `output_format`,
 * where the engine certifies it. Nothing here re-checks membership: a value that
 * reaches a script through a `with:` binding already passed that gate.
 *
 * There is deliberately no term for red that a work order asked for — a failing
 * assertion written because the failure is the finding. The delivery tail does not
 * carry red to a pull request, so no cause could mean "the failure is the
 * deliverable" without being a route around the one rule the gates exist to hold:
 * the only thing separating such a cause from ordinary introduced red would be a
 * label the declaring agent wrote about its own work. The finding still belongs in
 * the suite — as an expected failure, which keeps it pinned and re-run while the
 * suite stays green — and a change only the operator may make belongs in its own
 * item. Triage owns refusing that shape of work order before a run spends on it;
 * `sdlc/triage/commands/triage.md` states the precondition and `gate-green.ts`
 * states the same rule at the gate that would otherwise be the first to notice.
 *
 * Adding a member here widens what reaches a pull request. It is not a vocabulary
 * edit: `gate-green-red-vocabulary.test.ts` pins that every accepted cause still
 * refuses on a bare declaration, so a new one arrives with its evidence rule or
 * not at all.
 */

export const PASSES_RED = ['inherited', 'environment'] as const;

/** Red that the change did not cause: the base was already red, or the environment was. */
export function passesRed(cause: string): boolean {
  return (PASSES_RED as readonly string[]).includes(cause);
}
