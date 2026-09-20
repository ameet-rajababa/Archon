import { useEffect, useState, type ReactElement } from 'react';
import { describeActivity, formatElapsed } from '../primitives/activity';

interface WorkingIndicatorProps {
  /** The tool currently in flight, if the turn has reached one yet. */
  activity?: { name: string; input?: Record<string, unknown> } | null;
  /** When the current turn started, as epoch ms. */
  since?: number | null;
  /** Whether the inline tool trace is currently revealed. */
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Ticks once a second while a turn is in flight.
 *
 * The clock is the whole point. A long tool call — a type-check, a build — can
 * run for minutes without changing the activity line, and a line that does not
 * move is indistinguishable from a dead conversation. A moving number says
 * "still going" without inventing anything.
 */
function useElapsed(since: number | null | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null || since === undefined) return;
    setNow(Date.now());
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return (): void => {
      clearInterval(id);
    };
  }, [since]);
  if (since === null || since === undefined) return null;
  return formatElapsed(now - since);
}

/**
 * The single "agent is working" affordance, shown while a turn is in flight in
 * place of a stream of raw tool-call cards.
 *
 * It used to read `Agent is working · Bash`, which names the mechanism and not
 * the work. It now says what a person would say — "Running the tests",
 * "Reading tokens.css" — beside a clock. Deliberately not playful: an invented
 * verb fills the silence without telling you anything, and the reason this
 * exists is so that a still screen can only mean the turn is over or it is
 * your turn.
 */
export function WorkingIndicator({
  activity,
  since,
  expanded,
  onToggle,
}: WorkingIndicatorProps): ReactElement {
  const elapsed = useElapsed(since);
  const label =
    activity === null || activity === undefined || activity.name === ''
      ? 'Thinking'
      : describeActivity(activity.name, activity.input);

  return (
    <button
      type="button"
      onClick={onToggle}
      title={expanded ? 'Hide activity' : 'Show what the agent is doing'}
      aria-live="polite"
      className="mt-1.5 flex w-fit items-center gap-2 rounded-full border border-border bg-surface-inset px-3 py-1.5 text-[12px] text-text-secondary transition-colors hover:border-border-bright hover:text-text-primary"
    >
      <span
        aria-hidden
        className="h-3 w-3 shrink-0 animate-spin rounded-full border-2"
        style={{
          borderColor: 'color-mix(in oklch, var(--running) 25%, transparent)',
          borderTopColor: 'var(--running)',
        }}
      />
      <span className="font-medium text-text-primary">{label}</span>
      {elapsed !== null ? (
        <span className="font-mono text-[11px] text-text-tertiary tabular-nums">{elapsed}</span>
      ) : null}
      <span aria-hidden className="font-mono text-[10px] text-text-tertiary">
        {expanded ? '▾ hide' : '▸ details'}
      </span>
    </button>
  );
}
