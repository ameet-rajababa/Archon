import type { ReactElement } from 'react';
import { contextReading, formatTokens } from '../primitives/context-window';
import type { Message } from '../primitives/message';

/** Where the bar changes colour. Amber is "think about wrapping up", red is "do". */
const AMBER_AT = 0.4;
const RED_AT = 0.75;

/**
 * How full this chat's context is.
 *
 * The number that matters is the last turn's gross prompt input — everything
 * the model re-read. It is occupancy, not a total: when the provider compacts,
 * it DROPS, and that drop is the only visible sign that compaction happened at
 * all. A bar that only ever rises would be hiding the more interesting half.
 *
 * Renders nothing until a turn has reported usage, and shows the figure
 * WITHOUT a bar when the model's window is unknown — a percentage against a
 * guessed denominator is a confident lie, and this one would be used to decide
 * when to abandon a conversation.
 */
export function ContextBar({ messages }: { messages: readonly Message[] }): ReactElement | null {
  const reading = contextReading(messages);
  if (reading === null) return null;

  const { tokens, fraction, costUsd } = reading;
  const pct = fraction === null ? null : Math.min(1, fraction);
  const color =
    pct === null
      ? 'var(--text-tertiary)'
      : pct >= RED_AT
        ? 'var(--error)'
        : pct >= AMBER_AT
          ? 'var(--warning-mark)'
          : 'var(--text-tertiary)';

  const title = [
    `${formatTokens(tokens)} tokens replayed on the last turn`,
    pct === null ? 'model window unknown — no percentage claimed' : null,
    costUsd === null ? null : `$${costUsd.toFixed(2)} so far`,
  ]
    .filter((s): s is string => s !== null)
    .join(' · ');

  return (
    <span title={title} className="flex shrink-0 items-center gap-[7px] font-mono text-[10.5px]">
      {pct === null ? null : (
        <span
          aria-hidden
          className="h-[4px] w-[56px] overflow-hidden rounded-full"
          style={{ background: 'var(--surface-bright)' }}
        >
          <span
            className="block h-full rounded-full"
            style={{ width: `${String(Math.max(2, pct * 100))}%`, background: color }}
          />
        </span>
      )}
      <span style={{ color }}>
        {pct === null ? formatTokens(tokens) : `${String(Math.round(pct * 100))}%`}
      </span>
    </span>
  );
}
