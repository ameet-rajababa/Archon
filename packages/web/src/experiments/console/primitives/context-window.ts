/**
 * How full a chat's context is, and whether that can honestly be said at all.
 *
 * The reading itself is a turn's gross prompt input — everything the model
 * re-read, cache included. Turning it into a PERCENTAGE needs a denominator,
 * and the only correct denominator is the window of the model that actually
 * answered. Guessing one produces a gauge that is confidently wrong, which is
 * worse than no gauge: it would be read, believed, and used to decide when to
 * hand off.
 *
 * So an unknown model yields `null` here and the bar does not render. The
 * absolute figure is still worth showing, and it is still true.
 */

/**
 * Context windows, keyed by a substring of the model id the provider reports.
 *
 * Matched longest-first so a specific id wins over a family prefix. Deliberately
 * short: a model that is not listed reads as unknown rather than as a default,
 * because a default here is a guess wearing a number's clothes.
 */
const WINDOWS: readonly (readonly [match: string, tokens: number])[] = [
  ['claude-opus-4-1', 200_000],
  ['claude-sonnet-4-5', 200_000],
  ['claude-haiku-4-5', 200_000],
  ['claude-opus', 200_000],
  ['claude-sonnet', 200_000],
  ['claude-haiku', 200_000],
  ['gpt-5', 400_000],
  ['gpt-4.1', 1_047_576],
  ['gemini-2.5', 1_048_576],
];

/** The window for a model id, or null when we do not know it. */
export function contextWindow(model: string | null): number | null {
  if (model === null || model === '') return null;
  const id = model.toLowerCase();
  let best: { length: number; tokens: number } | null = null;
  for (const [match, tokens] of WINDOWS) {
    if (!id.includes(match)) continue;
    if (best === null || match.length > best.length) best = { length: match.length, tokens };
  }
  return best?.tokens ?? null;
}

export interface ContextReading {
  /** Gross prompt input on the most recent completed turn. */
  tokens: number;
  /** Fraction of the model's window, or null when the window is unknown. */
  fraction: number | null;
  /** What this chat has cost since it started, when every turn reported it. */
  costUsd: number | null;
}

/**
 * The newest turn that reported a reading, plus the running cost of all of them.
 *
 * Occupancy is the NEWEST value, never a sum: it describes the prefix replayed
 * on that turn, and it falls when the provider compacts. Cost is the opposite —
 * genuinely cumulative, because every turn was paid for separately.
 */
export function contextReading(
  messages: readonly { usage: { input: number; costUsd: number | null; model?: string } | null }[]
): ContextReading | null {
  let newest: { input: number; model: string | null } | null = null;
  let cost = 0;
  let sawCost = false;

  for (const m of messages) {
    if (m.usage === null) continue;
    newest = { input: m.usage.input, model: m.usage.model ?? null };
    if (m.usage.costUsd !== null) {
      cost += m.usage.costUsd;
      sawCost = true;
    }
  }
  if (newest === null) return null;

  const window = contextWindow(newest.model);
  return {
    tokens: newest.input,
    fraction: window === null ? null : newest.input / window,
    costUsd: sawCost ? cost : null,
  };
}

/** `163k`, `1.2M`, `840` — a token count at a glance. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000).toString()}k`;
  return n.toString();
}
