import type { ReactElement } from 'react';
import {
  HEALTH_COLOR,
  projectState,
  STATUS_COLOR,
  type ProjectStatus,
} from '../primitives/project-state';
import * as skill from '../skills';
import { useEntity } from '../store/cache';
import { K } from '../store/keys';

/** The mark carries the status as shape as well as colour, so it survives being
 *  read by someone who cannot separate the two. */
function Mark({ status }: { status: ProjectStatus }): ReactElement {
  const color = STATUS_COLOR[status];
  if (status === 'Clear') {
    return (
      <svg
        width="9"
        height="9"
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="3.4"
        aria-hidden
      >
        <path d="M4 12.5l5.5 5.5L20 6.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === 'Running') {
    return (
      <span aria-hidden className="relative inline-flex h-[7px] w-[7px] shrink-0">
        <span
          className="absolute inset-0 animate-ping rounded-full opacity-60"
          style={{ background: color }}
        />
        <span className="relative h-[7px] w-[7px] rounded-full" style={{ background: color }} />
      </span>
    );
  }
  // Waiting is a ring — open, unresolved. Idle is a filled dot — settled but
  // not empty. Two states that must not read as the same thing.
  return (
    <span
      aria-hidden
      className="h-[7px] w-[7px] shrink-0 rounded-full"
      style={
        status === 'Waiting'
          ? { border: `2px solid ${color}` }
          : { background: color, opacity: 0.7 }
      }
    />
  );
}

/**
 * Where a project is, in one or two words.
 *
 * The second word only appears when it has something to say, so its presence
 * is the signal — "Running" alone says more than "Running · Healthy" would.
 * The tooltip carries the arithmetic behind the word.
 */
export function ProjectStateChip({ projectId }: { projectId: string }): ReactElement | null {
  const { data } = useEntity<skill.ProjectCounts>(K.projectCounts(projectId), () =>
    skill.getProjectCounts(projectId)
  );
  if (data === undefined) return null;

  const state = projectState({
    running: data.running,
    paused: data.paused,
    recentStatuses: data.recentStatuses,
    openIssues: data.issues ?? 0,
    chats: data.chats,
  });

  return (
    <span
      title={state.why}
      className="inline-flex shrink-0 items-center gap-[6px] text-[11.5px] font-medium"
    >
      <Mark status={state.status} />
      <span style={{ color: STATUS_COLOR[state.status] }}>{state.status}</span>
      {state.health !== null ? (
        <>
          <span aria-hidden className="text-text-tertiary">
            ·
          </span>
          <span style={{ color: HEALTH_COLOR[state.health] }}>{state.health}</span>
        </>
      ) : null}
    </span>
  );
}
