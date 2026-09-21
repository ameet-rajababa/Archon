/**
 * How big a model's context window is.
 *
 * Lives here, next to the code that reads a turn's token usage, because this
 * is the only place that can pair the two: the provider reports which model
 * answered, and the window is what turns that request's input count into "how
 * full is this conversation".
 *
 * Deliberately ONE copy. The console needs the same figure, and rather than
 * keeping a second table in sync the resolved window is written alongside the
 * usage reading — so the client divides a number it was given instead of
 * looking one up. A table that exists twice is a table that disagrees.
 *
 * THIS TABLE IS A CACHE, NOT A SOURCE. The authority is the Models API
 * (`GET /v1/models/{id}` → `max_input_tokens`). The first version of this file
 * was written from memory and put every Claude model at 200k, which read a
 * 567k conversation as 283% full — on a model whose window is 1M. Anything not
 * listed resolves to null and no percentage is claimed, which is the only
 * behaviour that stays honest as models ship faster than this file is edited.
 */

/**
 * Windows keyed by a substring of the model id the provider reports.
 *
 * Matched longest-first, so a specific id beats the family it belongs to.
 * There is deliberately no family-level fallback: `claude-opus` cannot stand
 * for "every Opus", because that is precisely how a retired 200k figure
 * silently became the denominator for a 1M-window model.
 */
const WINDOWS: readonly (readonly [match: string, tokens: number])[] = [
  // 1M-window generation.
  ['claude-fable-5', 1_000_000],
  ['claude-mythos-5', 1_000_000],
  ['claude-opus-5', 1_000_000],
  ['claude-opus-4-8', 1_000_000],
  ['claude-opus-4-7', 1_000_000],
  ['claude-opus-4-6', 1_000_000],
  ['claude-sonnet-5', 1_000_000],
  ['claude-sonnet-4-6', 1_000_000],
  // 200k-window models still in service.
  ['claude-haiku-4-5', 200_000],
  ['claude-sonnet-4-5', 200_000],
  ['claude-opus-4-5', 200_000],
  // Other vendors.
  ['gpt-5', 400_000],
  ['gpt-4.1', 1_047_576],
  ['gemini-2.5', 1_048_576],
];

/** The context window for a model id, or null when it is not known. */
export function contextWindowFor(model: string | undefined | null): number | null {
  if (model === undefined || model === null || model === '') return null;
  const id = model.toLowerCase();
  let best: { length: number; tokens: number } | null = null;
  for (const [match, tokens] of WINDOWS) {
    if (!id.includes(match)) continue;
    if (best === null || match.length > best.length) best = { length: match.length, tokens };
  }
  return best?.tokens ?? null;
}
