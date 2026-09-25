/**
 * What the deploy replacing this server is doing, at the foot of the rail.
 *
 * WHY IT IS HERE AT ALL. A deploy on this install takes five to twenty minutes,
 * and until this strip existed the person who asked for it could see nothing.
 * The obvious workaround — asking the agent — is the bug: a deploy drains the box
 * before it swaps the container, waiting for the turns already in flight to
 * finish, and a question is a turn. On 2026-09-25 a chat that woke every twenty
 * minutes to check held the drain for 3116 seconds and the deploy failed; left
 * alone, the same commit went live in eleven minutes. So this reads `/api/health`
 * over plain HTTP, on the poll the rail already makes, and takes no conversation
 * lock at any point.
 *
 * WHY IT IS IN THE RAIL. A deploy replaces the whole install, not one project, and
 * the rail is the only chrome on every screen.
 *
 * It renders in the idle state too, quietly. A strip that appeared only during a
 * deploy could not be trusted to be absent for the right reason — "nothing on
 * screen" is also what a broken indicator looks like. The one state it renders
 * nothing for is not knowing: before the first answer, and on a server that
 * could not read its own deploy files.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { type DeployTone, deployStripView } from '../lib/deploy-strip';
import { elapsedSince, formatElapsed, relativeTime } from '../lib/format';
import { useDeployStatus } from '../lib/live-deploy';

const TONE_DOT: Record<DeployTone, string> = {
  live: 'bg-[color:var(--running)] animate-pulse',
  ok: 'bg-success/60',
  bad: 'bg-error',
  quiet: 'bg-text-tertiary/40',
};

const TONE_TEXT: Record<DeployTone, string> = {
  live: 'text-text-primary',
  ok: 'text-text-secondary',
  bad: 'text-error',
  quiet: 'text-text-tertiary',
};

/**
 * Ticks once a second while an attempt is in flight.
 *
 * The moving number is the point. Step 4 can build for six minutes and step 5 can
 * wait for twenty without a single line changing, and a strip that does not move
 * is indistinguishable from one that has died. The poll behind the rest of this
 * is every 30 seconds; this costs no requests at all.
 */
function useElapsed(startedAt: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return (): void => {
      clearInterval(id);
    };
  }, [startedAt]);
  if (startedAt === null) return null;
  return formatElapsed(elapsedSince(startedAt, new Date(now).toISOString()));
}

export function DeployStrip(): ReactElement | null {
  const { status } = useDeployStatus();
  const view = status === undefined ? null : deployStripView(status);
  const elapsed = useElapsed(view?.startedAt ?? null);

  if (view === null) return null;

  const ago = view.verdictAt === null ? null : relativeTime(view.verdictAt);
  // One sentence for a screen reader, because the visual version is a dot, two
  // sizes of text and a clock, and none of that reads aloud in order.
  const spoken = [view.label, view.detail, view.sha, elapsed ?? ago]
    .filter((part): part is string => part !== null)
    .join(' — ');

  return (
    <div className="border-t border-border px-3 py-2 text-[11px]" aria-live="polite">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-block size-2 shrink-0 rounded-full ${TONE_DOT[view.tone]}`}
        />
        <span className={`rail-hide min-w-0 flex-1 truncate font-semibold ${TONE_TEXT[view.tone]}`}>
          {view.label}
        </span>
        {elapsed !== null ? (
          <span className="rail-hide shrink-0 tabular-nums text-text-tertiary">{elapsed}</span>
        ) : null}
        {elapsed === null && ago !== null ? (
          <span className="rail-hide shrink-0 text-text-tertiary">{ago}</span>
        ) : null}
        <span className="sr-only">Deploy: {spoken}</span>
      </div>
      {view.detail !== null || view.sha !== null ? (
        <div className="rail-hide mt-0.5 flex items-baseline gap-1.5 pl-4">
          {view.sha !== null ? (
            <code className="shrink-0 tabular-nums text-text-tertiary">{view.sha}</code>
          ) : null}
          {view.detail !== null ? (
            // Clamped rather than truncated: a FAILED reason is a whole sentence
            // from the deploy log and the useful half is not always the first
            // forty characters.
            <span className="line-clamp-2 min-w-0 text-text-tertiary">{view.detail}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
