/**
 * The resolved chat-handoff thresholds, with their defaults applied.
 *
 * A separate resolver rather than `?? 40` at each call site: the same three
 * numbers are read by the thing that nudges and the thing that acts, and two
 * defaults that must agree by discipline are already a defect.
 */
import type { ChatsConfig } from './config-types';

export interface ResolvedChatsConfig {
  /** Fill fraction at which wrapping up is suggested. */
  nudgeAt: number;
  /** Fill fraction at which a handoff happens, at the next safe boundary. */
  handoffAt: number;
  /** Whether crossing `handoffAt` acts, or only reports. */
  autoHandoff: boolean;
}

const DEFAULT_NUDGE_PERCENT = 40;
const DEFAULT_HANDOFF_PERCENT = 50;

/**
 * Percentages become fractions here, and nonsense becomes the default.
 *
 * A percentage outside 1–99 is not a stricter policy, it is a typo: zero would
 * hand off on the first turn and 100 could never fire at all. Both are
 * silently useless in a way the operator would not discover for days, so a
 * value that cannot be meant is refused rather than honoured.
 *
 * A nudge above the handoff point is also refused — it would announce a
 * suggestion the system had already acted on.
 */
export function resolveChatsConfig(config: ChatsConfig | undefined): ResolvedChatsConfig {
  const handoffPercent = usable(config?.handoffAtPercent) ?? DEFAULT_HANDOFF_PERCENT;
  const nudgeRaw = usable(config?.nudgeAtPercent) ?? DEFAULT_NUDGE_PERCENT;
  const nudgePercent = nudgeRaw < handoffPercent ? nudgeRaw : DEFAULT_NUDGE_PERCENT;

  return {
    nudgeAt: nudgePercent / 100,
    handoffAt: handoffPercent / 100,
    autoHandoff: config?.autoHandoff ?? true,
  };
}

function usable(percent: number | undefined): number | undefined {
  if (percent === undefined || !Number.isFinite(percent)) return undefined;
  if (percent < 1 || percent > 99) return undefined;
  return percent;
}
