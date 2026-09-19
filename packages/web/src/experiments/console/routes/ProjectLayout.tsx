import type { ReactElement } from 'react';
import { Outlet } from 'react-router';
import { ProjectHeader } from '../components/ProjectHeader';

/**
 * Wraps every project-scoped view so the header is mounted once, above the
 * page, and survives navigation between Runs, Chat and a run's detail.
 *
 * Rendering it here rather than in each page is the whole fix: three pages
 * each drawing their own header meant three different headers, and the run
 * detail — which drew none — dropped the tabs entirely.
 *
 * `min-h-0` on the outlet wrapper so a page can own its own scrolling. Without
 * it the flex child takes its content's height and the whole console scrolls,
 * which has shipped twice before.
 */
export function ProjectLayout(): ReactElement {
  return (
    <>
      <ProjectHeader />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </>
  );
}
