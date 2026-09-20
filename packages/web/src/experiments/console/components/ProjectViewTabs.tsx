import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { writeProjectView } from '../lib/project-view';

interface ProjectViewTabsProps {
  projectId: string;
  active: 'overview' | 'runs' | 'chat' | 'issues';
}

const TABS: readonly {
  key: 'overview' | 'runs' | 'chat' | 'issues';
  label: string;
  suffix: string;
}[] = [
  // Overview first: it is the screen that answers "what should I do next",
  // and the tabs read left to right from orientation to detail.
  { key: 'overview', label: 'Overview', suffix: '/overview' },
  { key: 'runs', label: 'Runs', suffix: '' },
  { key: 'chat', label: 'Chat', suffix: '/chat' },
  { key: 'issues', label: 'Issues', suffix: '/issues' },
];

/**
 * Runs | Chat tab control under a project. Active styling mirrors FilterChips
 * (brand-bar underline). Only meaningful when a project is scoped — chat is
 * project-scoped, so this is never rendered on the All-projects view.
 *
 * Picking a tab records it as this project's view, so returning to the project
 * later lands on the same one. The write happens on click, before navigation,
 * so choosing Runs is seen as a choice rather than bounced back to Chat.
 */
export function ProjectViewTabs({ projectId, active }: ProjectViewTabsProps): ReactElement {
  return (
    <div className="flex items-center gap-1">
      {TABS.map(({ key, label, suffix }) => {
        const isActive = key === active;
        return (
          <Link
            key={key}
            to={`/console/p/${projectId}${suffix}`}
            onClick={() => {
              writeProjectView(projectId, key);
            }}
            aria-current={isActive ? 'page' : undefined}
            className={`relative rounded px-2 py-1 text-[11px] font-medium uppercase tracking-wider transition-colors ${
              isActive
                ? 'bg-surface-elevated text-text-primary'
                : 'text-text-tertiary hover:text-text-primary'
            }`}
          >
            {label}
            {isActive ? (
              <span
                aria-hidden
                className="brand-bar pointer-events-none absolute inset-x-1 -bottom-0.5 h-0.5 rounded-full"
              />
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
