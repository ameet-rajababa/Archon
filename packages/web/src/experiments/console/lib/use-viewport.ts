/**
 * Viewport width, as a reactive value.
 *
 * `useSyncExternalStore` rather than a resize effect, matching how `lib/clock`
 * already exposes ambient state: one listener for the whole app regardless of
 * how many components read it, and no render-after-render tearing when several
 * do.
 */
import { useSyncExternalStore } from 'react';

/**
 * Below this, two 268px rails and a transcript do not fit — the project rail
 * collapses to its icons. Chosen from where the layout actually breaks, not
 * from a device: at 1100px the transcript is already narrower than the
 * composer wants.
 */
export const RAIL_AUTO_COLLAPSE_PX = 1100;

function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
  };
}

export function useViewportWidth(): number {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth,
    // Server/prerender has no window; a wide default means nothing collapses
    // before the real width is known.
    () => 1920
  );
}
