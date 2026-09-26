/**
 * What the deploy replacing this server is doing, across the top of the console.
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
 * WHY IT IS IN THE HEADER. It used to sit at the foot of the rail, and on a phone
 * the rail is a drawer that is closed by default — so the one person who asked
 * for this could not see it on the device they read Archon from. A deploy
 * replaces the whole install rather than one project, so it belongs in the one
 * band that is on every route at every width. There is no rail copy any more:
 * two places rendering one fact is a pair kept in agreement by nobody.
 *
 * WHAT IT DROPS ON A NARROW SCREEN. The dot, the phase word and the clock survive
 * every width; the SHA and the holding sentence go below `sm`. That ordering is
 * deliberate — the clock is what tells you the deploy is alive, and the phase
 * word is what tells you whether you can type. The overlay in DeployOverlay picks
 * up the phases where the detail actually matters.
 *
 * It renders in the idle state too, quietly. A strip that appeared only during a
 * deploy could not be trusted to be absent for the right reason — "nothing on
 * screen" is also what a broken indicator looks like. The one state it renders
 * nothing for is not knowing: before the first answer, and on a server that
 * could not read its own deploy files.
 */

import { type ReactElement } from 'react';
import { type DeployTone, deployStripView } from '../lib/deploy-strip';
import { relativeTime } from '../lib/format';
import { useDeployElapsed, useDeployStatus } from '../lib/live-deploy';

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

export function DeployStrip(): ReactElement | null {
  const { status } = useDeployStatus();
  const view = status === undefined ? null : deployStripView(status);
  const elapsed = useDeployElapsed(view?.startedAt ?? null);

  if (view === null) return null;

  const ago = view.verdictAt === null ? null : relativeTime(view.verdictAt);
  // One sentence for a screen reader, because the visual version is a dot, two
  // weights of text and a clock, and none of that reads aloud in order.
  const spoken = [view.label, view.detail, view.sha, elapsed ?? ago]
    .filter((part): part is string => part !== null)
    .join(' — ');

  return (
    <div
      data-testid="deploy-strip"
      className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-1 text-[11px]"
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className={`inline-block size-2 shrink-0 rounded-full ${TONE_DOT[view.tone]}`}
      />
      <span className={`shrink-0 font-semibold ${TONE_TEXT[view.tone]}`}>{view.label}</span>
      {view.sha !== null ? (
        <code className="hidden shrink-0 tabular-nums text-text-tertiary sm:inline">
          {view.sha}
        </code>
      ) : null}
      {view.detail !== null ? (
        <span className="hidden min-w-0 flex-1 truncate text-text-tertiary sm:inline">
          {view.detail}
        </span>
      ) : null}
      <span className="flex-1" />
      {elapsed !== null ? (
        <span className="shrink-0 tabular-nums text-text-tertiary">{elapsed}</span>
      ) : null}
      {elapsed === null && ago !== null ? (
        <span className="shrink-0 text-text-tertiary">{ago}</span>
      ) : null}
      <span className="sr-only">Deploy: {spoken}</span>
    </div>
  );
}
