import type { ReactElement } from 'react';
import { contextReading, formatTokens, shortModel } from '../primitives/context-window';
import type { Message } from '../primitives/message';

/** Where the bar changes colour. Amber is "think about wrapping up", red is "do". */
const AMBER_AT = 0.4;
const RED_AT = 0.75;

/**
 * How full this chat's context is, said out loud: used, total, and the model
 * whose window that total belongs to.
 *
 * A bare percentage was not enough to act on. `81%` of what, on which model,
 * is the difference between "wrap up soon" and "this is fine" — and the same
 * conversation is half full on one model and a tenth full on another, so the
 * denominator has to be visible for the number to mean anything.
 *
 * The figure is occupancy on the LAST request of the last turn, which is the
 * only quantity a context window can be compared against. It is not the turn's
 * token total: a turn with twenty tool calls makes twenty requests, and
 * summing their inputs reports millions against a 200k window.
 *
 * Renders nothing until a turn has reported one. Shows the raw figure with no
 * bar and no percentage when the model's window is unknown — a percentage
 * against a guessed denominator is a confident lie, and this one decides when
 * a conversation gets abandoned.
 */
export function ContextBar({ messages }: { messages: readonly Message[] }): ReactElement | null {
  const reading = contextReading(messages);
  if (reading === null) return null;

  const { tokens, window, fraction, model, costUsd } = reading;
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
    window === null
      ? `${tokens.toLocaleString()} tokens in context`
      : `${tokens.toLocaleString()} of ${window.toLocaleString()} tokens in context`,
    model === null ? null : model,
    window === null ? 'model window unknown — no percentage claimed' : null,
    costUsd === null ? null : `$${costUsd.toFixed(2)} so far`,
  ]
    .filter((s): s is string => s !== null)
    .join(' · ');

  return (
    <span title={title} className="flex shrink-0 items-center gap-[7px] font-mono text-[10.5px]">
      {pct === null ? null : (
        <span
          aria-hidden
          className="h-[4px] w-[48px] shrink-0 overflow-hidden rounded-full"
          style={{ background: 'var(--surface-bright)' }}
        >
          <span
            className="block h-full rounded-full"
            style={{ width: `${String(Math.max(2, pct * 100))}%`, background: color }}
          />
        </span>
      )}
      <span style={{ color }}>
        {formatTokens(tokens)}
        {window === null ? '' : `/${formatTokens(window)}`}
        {pct === null ? '' : ` ${String(Math.round(pct * 100))}%`}
      </span>
      {model === null ? null : (
        <span className="truncate text-text-tertiary">{shortModel(model)}</span>
      )}
    </span>
  );
}
