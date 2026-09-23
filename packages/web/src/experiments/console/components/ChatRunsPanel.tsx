import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import { useEntity } from '../store/cache';
import { K } from '../store/keys';
import { useDashboardSSE } from '../lib/sse';
import * as skill from '../skills';
import type { Run } from '../primitives/run';
import type { RunCounts } from '../skills/runs';
import { statusDotClass, runStatusLabel } from '../lib/run-status';
import { shortRunId, relativeTime } from '../lib/format';
import { RunOutcomeBadge } from './RunOutcomeBadge';

interface FeedData {
  runs: Run[];
  counts: RunCounts;
  total: number;
}

interface ChatRunsPanelProps {
  /**
   * Conversation DB id of the chat being viewed — what a run's
   * `parent_conversation_id` points at, NOT the platform id the message and
   * stream routes take.
   */
  conversationDbId: string;
  projectId: string;
}

/** Rows shown before the list truncates behind "Show all". */
const COLLAPSED_ROWS = 5;
/** Server-side page size. Deep history belongs on the runs view, not the chat. */
const FETCH_LIMIT = 25;

/**
 * The runs this chat launched, newest first, in progress and finished alike —
 * filtered server-side on `parent_conversation_id`.
 *
 * Sits directly above {@link WorkflowDock}, which keeps its project scope and
 * its position against the composer: the two answer different questions
 * ("what is this project running?" vs. "what did I start from here?") and a
 * run can legitimately appear in both.
 */
export function ChatRunsPanel({
  conversationDbId,
  projectId,
}: ChatRunsPanelProps): ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  const { data, error } = useEntity<FeedData>(K.chatRuns(conversationDbId), () =>
    skill.listRuns({ parentConversationId: conversationDbId, limit: FETCH_LIMIT })
  );
  useDashboardSSE();

  // Render nothing until the first load settles, rather than flashing an empty
  // state the response is about to contradict.
  if (data === undefined && error === undefined) return null;

  const runs = data?.runs ?? [];
  const visible = expanded ? runs : runs.slice(0, COLLAPSED_ROWS);

  return (
    <div className="max-h-[32vh] shrink-0 overflow-y-auto border-t border-border bg-surface-inset/40 px-6 py-2">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-secondary">
          From this chat
        </span>
        {runs.length > 0 ? (
          <span className="font-mono text-[11px] tabular-nums text-text-tertiary">
            {runs.length.toString()}
          </span>
        ) : null}
      </div>

      {error !== undefined ? (
        <p className="font-mono text-[11px] text-error">
          Couldn&apos;t load this chat&apos;s runs: {error.message}
        </p>
      ) : runs.length === 0 ? (
        <p className="font-mono text-[11px] text-text-tertiary">
          No runs started from this chat yet.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            {visible.map(run => (
              <ChatRunRow key={run.id} run={run} projectId={projectId} />
            ))}
          </div>
          {runs.length > COLLAPSED_ROWS ? (
            <button
              type="button"
              onClick={() => {
                setExpanded(v => !v);
              }}
              className="mt-1 font-mono text-[11px] text-text-tertiary transition-colors hover:text-text-primary"
            >
              {expanded ? 'Show fewer' : `Show all ${runs.length.toString()}`}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

/** One-line run row: status, workflow, brief, age — links to the run detail. */
function ChatRunRow({ run, projectId }: { run: Run; projectId: string }): ReactElement {
  return (
    <Link
      to={`/console/p/${projectId}/r/${run.id}`}
      title="Open run"
      className="flex items-center gap-2.5 rounded border border-border/50 bg-surface px-2.5 py-1.5 text-left transition-colors hover:border-border-bright hover:bg-surface-hover"
    >
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass[run.status]}`} />
      <span className="shrink-0 text-[12.5px] font-medium text-text-primary">{run.workflow}</span>
      <span className="shrink-0 font-mono text-[10px] text-text-tertiary">
        {shortRunId(run.id)}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-text-secondary">
        {runStatusLabel(run)}
      </span>
      <RunOutcomeBadge outcome={run.outcome} />
      <span className="min-w-0 flex-1 truncate text-[12px] text-text-tertiary">
        {run.userMessage}
      </span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-tertiary">
        {relativeTime(run.startedAt)}
      </span>
    </Link>
  );
}
