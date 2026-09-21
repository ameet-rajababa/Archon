import type { ReactElement } from 'react';

/**
 * Broadcast-style "live" indicator for running runs.
 *
 * The mark itself is `live-mark` (rail.css) — the same breathe and radiating
 * ring a working chat wears, on the same 1.9s. It used to draw its own ring
 * with Tailwind's `animate-ping` at 1s, which put two marks meaning "right
 * now" visibly out of step whenever a run card and the rail were both on
 * screen.
 */
export function LiveDot({ size = 10 }: { size?: number }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <span
        className="live-mark rounded-full bg-[color:var(--running)]"
        style={{ width: size * 0.65, height: size * 0.65 }}
      />
    </span>
  );
}
