/**
 * How full a chat's context is, and whether that can honestly be said at all.
 *
 * The reading is a turn's gross prompt input — everything the model re-read,
 * cache included. Turning it into a PERCENTAGE needs the window of the model
 * that actually answered, and that is resolved SERVER-SIDE and written
 * alongside the reading (see core/orchestrator/context-window.ts). This file
 * divides; it does not look anything up.
 *
 * That split is the point. A second table here would be a second opinion about
 * how full a conversation is, and the two would drift the first time either
 * was edited. Where the server could not name a window, there is no
 * percentage — the bar shows the raw figure and claims nothing. A guessed
 * denominator would be believed, and it decides when a chat gets abandoned.
 */

export interface ContextReading {
  /** How full the context was when the last turn ended. */
  tokens: number;
  /** The model's window — the denominator — or null when it is not known. */
  window: number | null;
  /** Fraction of that window, or null when the server named no window. */
  fraction: number | null;
  /** The model that answered, as the provider named it. */
  model: string | null;
  /** What this chat has cost so far, when turns reported it. */
  costUsd: number | null;
}

/**
 * The newest turn that reported a reading, plus the running cost of all of them.
 *
 * Occupancy is the NEWEST value, never a sum: it describes the prefix replayed
 * on that turn, and it FALLS when the provider compacts — which is the only
 * visible sign compaction happened. Cost is the opposite and is summed,
 * because every turn was paid for separately.
 */
export function contextReading(
  messages: readonly {
    usage: {
      context?: number;
      input: number;
      costUsd: number | null;
      window?: number;
      model?: string;
    } | null;
  }[]
): ContextReading | null {
  let newest: { tokens: number; window: number | null; model: string | null } | null = null;
  let cost = 0;
  let sawCost = false;

  for (const m of messages) {
    if (m.usage === null) continue;
    // `context` only. `input` is the turn's TOTAL — every request summed — so
    // a tool-heavy turn reports millions against a 200k window. A reading
    // written before that distinction existed is skipped for occupancy rather
    // than shown as 6600% full.
    if (m.usage.context !== undefined) {
      newest = {
        tokens: m.usage.context,
        window: m.usage.window ?? null,
        model: m.usage.model ?? null,
      };
    }
    if (m.usage.costUsd !== null) {
      cost += m.usage.costUsd;
      sawCost = true;
    }
  }
  if (newest === null) return null;

  return {
    tokens: newest.tokens,
    window: newest.window,
    fraction: newest.window === null ? null : newest.tokens / newest.window,
    model: newest.model,
    costUsd: sawCost ? cost : null,
  };
}

/**
 * `claude-opus-5-20260101` → `opus-5`. The vendor prefix and the build date
 * are the same on every model in a fleet, so they cost width and say nothing.
 * The full id stays in the tooltip.
 */
export function shortModel(model: string): string {
  return model
    .replace(/^(anthropic|openai|google|claude|gpt|gemini)[-/]/i, m =>
      /^(gpt|gemini)/i.test(m) ? m : ''
    )
    .replace(/-\d{8}$/, '');
}

/** `163k`, `1.2M`, `840` — a token count at a glance. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000).toString()}k`;
  return n.toString();
}
