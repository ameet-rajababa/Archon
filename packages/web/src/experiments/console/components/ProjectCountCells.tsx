import { MessageCircle, Play } from 'lucide-react';
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
  tone?: 'running';
}): ReactElement {
  return (
    <span
      title={title}
      className="w-[20px] shrink-0 text-right font-mono text-[11px] tabular-nums"
      style={{ color: tone === 'running' ? 'var(--running)' : 'var(--text-tertiary)' }}
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

  return (
    <span className="flex shrink-0 items-center gap-[7px]">
      <Cell
        value={chats}
        title={chats === null ? 'Chats' : `${chats} active chat${chats === 1 ? '' : 's'}`}
      />
      <Cell
        value={runs}
        tone={running > 0 ? 'running' : undefined}
        title={
          runs === null
            ? 'Runs'
            : `${runs} run${runs === 1 ? '' : 's'}${running > 0 ? `, ${running} running now` : ''}`
        }
      />
    </span>
  );
}

/** Header row for the count columns, aligned to the same cell widths. */
export function ProjectCountHeader(): ReactElement {
  const ico = 'h-[11px] w-[11px]';
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center gap-[7px] text-text-tertiary opacity-75"
    >
      <span className="flex w-[20px] justify-end" title="Chats">
        <MessageCircle className={ico} />
      </span>
      <span className="flex w-[20px] justify-end" title="Runs">
        <Play className={ico} />
      </span>
    </span>
  );
}

/** Memoized: the rail re-renders on every cache event, the numbers rarely change. */
/* eslint-disable-next-line @typescript-eslint/naming-convention --
   A memoized component is a const, and a component must be PascalCase for JSX
   to treat it as one. The rule cannot express "const holding a component". */
export const ProjectCountCells = memo(ProjectCountCellsImpl, (a, b) => a.projectId === b.projectId);
