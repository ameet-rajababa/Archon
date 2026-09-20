import { MessageCircle, Play, CircleDot } from 'lucide-react';
import { memo, type ReactElement } from 'react';
import * as skill from '../skills';
import { useEntity } from '../store/cache';
import { K } from '../store/keys';

/**
 * The three numbers on a project row: chats, runs, open issues.
 *
 * Fixed-width cells so the columns line up down the whole rail — that is what
 * makes them readable as a table rather than as a row of tokens on each line.
 * Zero renders BLANK. An empty cell says "none" faster than a `0` does, and it
 * keeps the quiet projects quiet.
 *
 * Two columns, not the three the design draws. The issues endpoint does not
 * exist yet, and a permanently empty third column costs ~30px of the name —
 * enough to truncate `claude-skills` to `claud…`. It comes back with the data,
 * and the one-time reflow is cheaper than the characters.
 */
function Cell({
  value,
  title,
  tone,
}: {
  value: number | null;
  title: string;
  tone?: 'running' | 'attention';
}): ReactElement {
  return (
    <span
      title={title}
      className={`cell${tone === 'running' ? ' live' : ''}${tone === 'attention' ? ' needs-you' : ''}`}
    >
      {value !== null && value > 0 ? value : ''}
    </span>
  );
}

function ProjectCountCellsImpl({ projectId }: { projectId: string }): ReactElement {
  const { data } = useEntity<skill.ProjectCounts>(K.projectCounts(projectId), () =>
    skill.getProjectCounts(projectId)
  );

  const chats = data?.chats ?? null;
  const runs = data?.runs ?? null;
  const running = data?.running ?? 0;
  const paused = data?.paused ?? 0;

  return (
    <span className="rail-hide rail-counts">
      <Cell
        value={chats}
        title={chats === null ? 'Chats' : `${chats} active chat${chats === 1 ? '' : 's'}`}
      />
      {/* Amber wins over blue: waiting on YOU outranks the machine being busy. */}
      <Cell
        value={runs}
        tone={paused > 0 ? 'attention' : running > 0 ? 'running' : undefined}
        title={
          runs === null
            ? 'Runs in play'
            : runs === 0
              ? 'Nothing running'
              : [
                  running > 0 ? `${running} running` : null,
                  paused > 0 ? `${paused} waiting on you` : null,
                ]
                  .filter(Boolean)
                  .join(', ') || `${runs} in play`
        }
      />
      <Cell
        value={data?.issues ?? null}
        title={
          data?.issues === null || data?.issues === undefined
            ? 'Open issues — not available for this project'
            : `${data.issues} open issue${data.issues === 1 ? '' : 's'}`
        }
      />
    </span>
  );
}

/** Header row for the count columns, aligned to the same cell widths. */
export function ProjectCountHeader(): ReactElement {
  const ico = 'h-[11px] w-[11px]';
  return (
    <span aria-hidden className="rail-hide rail-counts">
      <span className="cell" title="Chats">
        <MessageCircle className={ico} />
      </span>
      <span className="cell" title="Runs">
        <Play className={ico} />
      </span>
      <span className="cell" title="Open issues">
        <CircleDot className={ico} />
      </span>
    </span>
  );
}

/** Memoized: the rail re-renders on every cache event, the numbers rarely change. */
/* eslint-disable-next-line @typescript-eslint/naming-convention --
   A memoized component is a const, and a component must be PascalCase for JSX
   to treat it as one. The rule cannot express "const holding a component". */
export const ProjectCountCells = memo(ProjectCountCellsImpl, (a, b) => a.projectId === b.projectId);
