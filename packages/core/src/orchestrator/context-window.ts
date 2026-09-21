/**
 * How big a model's context window is.
 *
 * Lives here, next to the code that reads a turn's token usage, because this
 * is the only place that can pair the two: the provider reports which model
 * answered, and the window is what turns that turn's input count into "how
 * full is this conversation".
 *
 * Deliberately ONE copy. The console needs the same figure, and rather than
 * keeping a second table in sync the resolved window is written alongside the
 * usage reading — so the client divides a number it was given instead of
 * looking one up. A table that exists twice is a table that disagrees.
 */

/**
 * Windows keyed by a substring of the model id the provider reports.
 *
 * Matched longest-first, so a specific id beats the family it belongs to. Kept
 * short on purpose: an unlisted model resolves to `null` rather than to a
 * default, because a default here is a guess that would be read as a fact —
 * and this number decides when a conversation gets abandoned.
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
