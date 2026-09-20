import type { ReactElement } from 'react';
import { useLocation, useParams } from 'react-router';
import { ProjectViewTabs } from './ProjectViewTabs';
import { ProjectStateChip } from './ProjectStateChip';
import { useEntity } from '../store/cache';
import { K } from '../store/keys';
import * as skill from '../skills';
import type { Project } from '../primitives/project';
import type { RunCounts } from '../skills/runs';
import {
  activeProjectTab,
  activityNeedsYou,
  activitySummary,
  allProjectsSubtitle,
} from '../lib/project-header';

interface FeedShape {
  counts: RunCounts;
}

/**
 * The project header, rendered once by the layout rather than by each page.
 *
 * It used to be duplicated in RunsPage and ChatPage and absent from the run
 * detail — so opening a run replaced the whole header, taking the path and the
 * Runs/Chat tabs with it, and a run that failed to load left a bare error on an
 * empty page with no way back.
 *
 * Its height is fixed in every state on purpose: name, path, tabs. A header
 * that grows or shrinks between screens shifts everything below it, which is
 * the thing being fixed here rather than a detail of it.
 */
export function ProjectHeader(): ReactElement {
  const { projectId } = useParams<{ projectId?: string }>();
  const { pathname } = useLocation();
  const scope = projectId ?? 'all';

  // Same cache keys the pages use, so this is a read of data already fetched
  // rather than a second request per navigation.
  const { data: project } = useEntity<Project | null>(
    projectId === undefined ? 'noop:all-projects' : K.project(projectId),
    () => (projectId === undefined ? Promise.resolve(null) : skill.getProject(projectId))
  );
  const { data: feed } = useEntity<FeedShape>(K.runs(scope), () =>
    skill.listRuns(
      projectId === undefined
        ? { limit: skill.RUN_LIMIT }
        : { codebaseId: projectId, limit: skill.RUN_LIMIT }
    )
  );
  const { data: projects } = useEntity<Project[]>(K.projects, () => skill.listProjects());

  const counts = feed?.counts ?? null;
  const activity = activitySummary(counts);
  const needsYou = activityNeedsYou(counts);

  return (
    <header className="flex shrink-0 flex-col gap-3 border-b border-border px-6 pb-0 pt-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate text-base font-medium text-text-primary">
              {projectId === undefined ? 'All projects' : (project?.name ?? 'Project')}
            </h1>
            {/* Where this project is, in one or two words. Beside the name
                because it is a property of the project, not of the page. */}
            {projectId !== undefined ? <ProjectStateChip projectId={projectId} /> : null}
          </span>
          {/* Always rendered, even while loading: an absent second line would
              change the header's height and shift the page under the reader. */}
          <p className="truncate text-xs text-text-tertiary">
            {projectId === undefined
              ? allProjectsSubtitle(projects?.length ?? 0, counts)
              : (project?.path ?? 'Loading…')}
          </p>
        </div>

        {activity !== null ? (
          <span
            className="flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.12em]"
            style={{ color: needsYou ? 'var(--warning)' : 'var(--brand-blue)' }}
          >
            <span aria-hidden className="h-[6px] w-[6px] rounded-full bg-current" />
            {activity}
          </span>
        ) : null}
      </div>

      {projectId === undefined ? (
        // No project scoped means no tab can be meaningful, but the row still
        // occupies its space so the header is one height everywhere.
        <div aria-hidden className="h-[26px]" />
      ) : (
        <ProjectViewTabs projectId={projectId} active={activeProjectTab(pathname)} />
      )}
    </header>
  );
}
