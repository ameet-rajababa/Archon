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
