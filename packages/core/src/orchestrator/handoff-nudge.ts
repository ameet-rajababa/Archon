/**
 * When to say something about how full a chat has got.
 *
 * Pure, because the rule worth testing is not "how do I send a message" but
 * "how often is this allowed to speak". A reminder that fires every turn past
 * a threshold is not a reminder, it is a status bar with a worse presentation,
 * and the reader stops seeing it — which is the failure this whole feature
 * exists to avoid.
 *
 * So a band fires ONCE. Crossing 40% says so; the next turn at 43% says
 * nothing; crossing 50% speaks again because it is a different thing to say.
 */

export type NudgeBand = 'none' | 'nudge' | 'handoff';

/** Which band a reading falls in. `handoff` wins — it is the more urgent half. */
export function bandFor(fraction: number, nudgeAt: number, handoffAt: number): NudgeBand {
  if (fraction >= handoffAt) return 'handoff';
  if (fraction >= nudgeAt) return 'nudge';
  return 'none';
}

/**
 * Whether this band is worth saying out loud, given what was last said.
 *
 * Only an INCREASE speaks. Occupancy falls when the provider compacts, and a
 * chat that drops from 50% to 20% and climbs back has not learned anything new
 * to tell you — but it has re-armed, so the next genuine crossing is heard.
 */
export function shouldAnnounce(previous: NudgeBand, current: NudgeBand): boolean {
  const rank: Record<NudgeBand, number> = { none: 0, nudge: 1, handoff: 2 };
  return rank[current] > rank[previous];
}

/** What the reader is told. Percentages are rounded — nobody acts on a decimal. */
export function nudgeMessage(band: Exclude<NudgeBand, 'none'>, fraction: number): string {
  const pct = String(Math.round(fraction * 100));
  if (band === 'handoff') {
    return `This chat is ${pct}% of the model's context window. Time to hand off — ask me to, and I'll write the document and carry the work into a fresh chat.`;
  }
  return `This chat is ${pct}% of the model's context window. Worth wrapping up soon; say the word and I'll hand off.`;
}

/**
 * Why an automatic handoff must wait, or `null` when nothing is in the way.
 *
 * Both hold for the same reason: a handoff moves the work into a chat that
 * cannot see this one, so anything still owed to a human here would be left
 * behind with nobody to notice. The successor would read the document, find a
 * decision unmade, and make it — which is precisely the decision somebody asked
 * to keep.
 */
export type HandoffBlocker = 'awaiting-approval' | 'open-question';

/**
 * Whether the reply ends with an ask block still open.
 *
 * The fence is the contract (see `splitReply` in the console's `ask` primitive,
 * which renders the other half of it). A run of three or more backticks or
 * tildes tagged `ask`, closed by the same character at the same length or
 * longer — and an ask fence nested INSIDE a longer fence is a demonstration,
 * not a question. That nesting rule is the whole reason this is a scanner and
 * not a regex: every document that explains ask blocks contains one, and a
 * naive match would read those as a permanently open question and never hand
 * off again.
 *
 * Duplicated rather than imported because core cannot depend on the web client.
 * `handoff-nudge.test.ts` holds the fixtures that keep the two honest.
 */
export function hasOpenAsk(reply: string): boolean {
  const FENCE = /^([ \t]*)(`{3,}|~{3,})[ \t]*(\S*)[ \t]*$/;
  const lines = reply.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const open = FENCE.exec(lines[i] ?? '');
    if (open === null) continue;
    const marker = open[2] ?? '';
    const char = marker[0] ?? '`';

    // Find this block's own close: same character, at least as long, no tag.
    let closeAt = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const close = FENCE.exec(lines[j] ?? '');
      if (
        close !== null &&
        close[3] === '' &&
        (close[2] ?? '').startsWith(char) &&
        (close[2] ?? '').length >= marker.length
      ) {
        closeAt = j;
        break;
      }
    }
    // An unterminated fence never became a block — the console renders the rest
    // as prose, so there is no card and no question.
    if (closeAt === -1) return false;
    if (open[3] === 'ask') return true;
    // Not an ask block: skip everything it encloses, demonstrations included.
    i = closeAt;
  }
  return false;
}

/** What a reading should cause. `hand-off` is the only one that acts. */
export type HandoffAction =
  | { kind: 'silent' }
  | { kind: 'announce'; message: string }
  | { kind: 'hand-off' };

/**
 * What to do about a reading, given the band already reported and what the chat
 * still owes a human.
 *
 * Pure for the same reason the rest of this file is: the judgement worth
 * testing is "may this act, and if not why", not "how is a message sent".
 *
 * A blocked automatic handoff SAYS SO rather than falling silent. The whole
 * point of the setting is unattended running, and a chat that quietly declined
 * to hand off at 3am is indistinguishable from one that never reached the
 * threshold. Naming the blocker is what makes the morning readable.
 */
export function handoffAction(input: {
  band: NudgeBand;
  previous: NudgeBand;
  fraction: number;
  autoHandoff: boolean;
  blocker: HandoffBlocker | null;
}): HandoffAction {
  const { band, previous, fraction, autoHandoff, blocker } = input;
  if (band === 'none' || !shouldAnnounce(previous, band)) return { kind: 'silent' };
  if (band !== 'handoff' || !autoHandoff) {
    return { kind: 'announce', message: nudgeMessage(band, fraction) };
  }
  if (blocker === null) return { kind: 'hand-off' };

  const pct = String(Math.round(fraction * 100));
  const because =
    blocker === 'awaiting-approval'
      ? 'a run here is waiting on your approval'
      : 'there is an open question above';
  return {
    kind: 'announce',
    message: `This chat is ${pct}% of the model's context window and would hand off now, but ${because}. Answer it and I'll move the work into a fresh chat.`,
  };
}
