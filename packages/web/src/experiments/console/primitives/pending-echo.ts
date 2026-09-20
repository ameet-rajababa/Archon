/**
 * When the optimistic echo of a sent message should retire.
 *
 * Extracted so the rule is testable without a DOM. It looked trivial inline
 * and was not: the first version compared a COUNT of user rows against a
 * baseline captured in a render closure, so a `messages` that was one refetch
 * stale left the baseline too high. The count then never exceeded it, the echo
 * never retired, and the message appeared twice a second apart — while only
 * one row had ever been persisted.
 */

/** Ids of the user rows present when the echo was raised. */
export function baselineUserIds(
  messages: readonly { id: string; role: string }[]
): ReadonlySet<string> {
  return new Set(messages.filter(m => m.role === 'user').map(m => m.id));
}

/**
 * True once a user row exists that was not there when the echo was raised.
 *
 * Identity rather than arithmetic: unambiguous under a stale read, when the
 * same text is sent twice, and across the new-chat id switch that empties the
 * list before the real row lands.
 */
export function echoHasLanded(
  messages: readonly { id: string; role: string }[],
  baseline: ReadonlySet<string>
): boolean {
  return messages.some(m => m.role === 'user' && !baseline.has(m.id));
}
