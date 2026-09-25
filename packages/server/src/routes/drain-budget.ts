/**
 * The drain budget ceiling, in a module of its own so a deploy can read it.
 *
 * It lives apart from `internal-drain.ts` because the caller that has to respect
 * this number is not a server: `scripts/drain-wait.ts` clamps a deploy's budget
 * to it before arming drain, and importing the route to get it dragged the whole
 * of `@archon/core` into the scripts TypeScript project — far enough to reach a
 * shell script imported as text, whose ambient declaration that project cannot
 * see. A file with no imports can be read from anywhere, which is what a shared
 * constant has to be.
 *
 * The alternative was to repeat 3600 in the deploy script. A limit enforced in
 * one place and assumed in another is exactly the pair that goes quietly wrong.
 */

/**
 * An unbounded drain would be indistinguishable from a wedged box, and no deploy
 * legitimately waits an hour for one. Past this the operator should be asking why
 * the box will not go quiet, not extending the wait.
 */
export const MAX_DRAIN_BUDGET_SECONDS = 3600;
