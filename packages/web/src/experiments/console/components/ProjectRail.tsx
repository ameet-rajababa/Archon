import { Search, Inbox, Play } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link, useNavigate, useLocation } from 'react-router';
import { Settings, PenTool, type LucideIcon } from 'lucide-react';
import { ProjectRow } from './ProjectRow';
import { ProjectCountHeader } from './ProjectCountCells';
import type { RunCounts } from '../skills';
import { EnvVarsDialog } from './EnvVarsDialog';
import { useEntity, invalidate } from '../store/cache';
import { K } from '../store/keys';
import * as skill from '../skills';
import type { Project } from '../primitives/project';

interface ProjectRailProps {
  onAddProject: () => void;
  /** Opens the command palette — the rail's search row is a shortcut to it. */
  onSearch: () => void;
}

async function handleRemove(projectId: string): Promise<void> {
  await skill.removeProject(projectId);
  invalidate(K.projects);
}

/** Extract the project id from /console/p/:id (and /console/p/:id/r/:runId). */
function extractProjectId(pathname: string): string | null {
  const m = /^\/console\/p\/([^/]+)/.exec(pathname);
  return m === null ? null : m[1];
}

/**
 * Runs executing right now, across every project.
 *
 * The glyph is what says "runs" — a bare "2 running" leaves the reader to
 * guess what is running, which is a question this exact line has been asked
 * twice. Renders nothing at zero.
 */
function GlobalRunning(): ReactElement | null {
  const { data } = useEntity<RunCounts>(K.countsGlobal, skill.listGlobalCounts);
  const n = data?.running ?? 0;
  if (n === 0) return null;
  return (
    <span
      title={`${n} run${n === 1 ? '' : 's'} executing right now, across all projects`}
      className="flex shrink-0 items-center gap-[5px] font-mono text-[11px]"
      style={{ color: 'var(--running)' }}
    >
      <Play className="h-[11px] w-[11px]" />
      {n} running
    </span>
  );
}

const RAIL_WIDTH_KEY = 'archon.console.railWidth';
const RAIL_MIN = 232;
const RAIL_MAX = 440;
const RAIL_DEFAULT = 280;

function readRailWidth(): number {
  try {
    const v = parseInt(localStorage.getItem(RAIL_WIDTH_KEY) ?? '', 10);
    return v >= RAIL_MIN && v <= RAIL_MAX ? v : RAIL_DEFAULT;
  } catch {
    return RAIL_DEFAULT;
  }
}

function writeRailWidth(w: number): void {
  try {
    localStorage.setItem(RAIL_WIDTH_KEY, String(w));
  } catch {
    /* ignore */
  }
}

const RAIL_NAV_LINK_CLASS =
  'flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary';

/** A row in the rail's bottom nav menu (Builder / Settings / Workflows / Old UI). */
function RailNavLink({
  to,
  icon: Icon,
  label,
  title,
  badge,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  title?: string;
  /** Optional pill after the label (rail-header "console" pill styling). */
  badge?: string;
}): ReactElement {
  return (
    <Link to={to} title={title} className={RAIL_NAV_LINK_CLASS}>
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
      {badge !== undefined ? (
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-text-tertiary">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * Left rail, design v2: header with count pill, filter input, projects
 * grouped by owner with hairline section labels, and a drag handle on the
 * right edge (232–440px, persisted).
 *
 * Note: ProjectRail mounts outside the inner `<Routes>` (sibling to the
 * <main> that hosts them), so `useParams()` returns `{}` here even on a
 * project URL. We extract the project id from the pathname directly.
 */
export function ProjectRail({ onAddProject, onSearch }: ProjectRailProps): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const scope = extractProjectId(location.pathname) ?? 'all';
  const [envProject, setEnvProject] = useState<Project | null>(null);
  /* The filter box became the Search row. `query` stays as the empty
     default so the list logic below is untouched and can be wired to the
     palette's own filter later without another rewrite. */
  const query = '';
  const [width, setWidth] = useState<number>(readRailWidth);
  const [resizing, setResizing] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  const { data: projects, error } = useEntity<Project[]>(K.projects, () => skill.listProjects());

  const allSelected = scope === 'all';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = projects ?? [];
    if (q.length === 0) return list;
    return list.filter(p => `${p.name} ${p.path}`.toLowerCase().includes(q));
  }, [projects, query]);

  /**
   * One flat list, not owner groups.
   *
   * The owner still identifies the project — it is in the row's tooltip and in
   * the name when it differs from the display name — but it no longer dictates
   * position. Grouping and a hand-chosen order are mutually exclusive, and the
   * order you choose is the more useful of the two.
   */
  const flat = filtered;

  // Pointer-driven resize; width clamps to [RAIL_MIN, RAIL_MAX] and persists
  // on release. Pointer capture keeps the drag alive outside the handle.
  const startResize = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;
    let latest = startW;
    setResizing(true);
    const move = (ev: PointerEvent): void => {
      latest = Math.max(RAIL_MIN, Math.min(RAIL_MAX, startW + (ev.clientX - startX)));
      setWidth(latest);
    };
    const up = (): void => {
      setResizing(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      writeRailWidth(latest);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  return (
    <nav
      aria-label="Projects"
      style={{ width, flexBasis: width }}
      className="relative flex h-full shrink-0 flex-col border-r border-border bg-surface-inset"
    >
      {/* Header: brand + label + count + filter */}
      <div className="px-3.5 pb-2.5 pt-4">
        <div className="flex items-center gap-2.5 px-1 pb-2">
          <img
            src="/favicon.png"
            alt=""
            aria-hidden="true"
            width={18}
            height={18}
            className="shrink-0 select-none"
            draggable={false}
          />
          <span className="brand-text text-base font-semibold tracking-tight">Archon</span>
        </div>
        {/* A ROW, not a text field. The box was permanent chrome for something
            done occasionally, and the palette already jumps to a project by
            name — across every project, not just the visible list. */}
        <button
          type="button"
          onClick={onSearch}
          title="Search  ⌘K"
          className="group flex w-full items-center gap-[10px] rounded-[7px] px-2.5 py-[5px] text-left transition-colors hover:bg-surface-hover"
        >
          <span
            aria-hidden
            className="flex h-[17px] w-[17px] shrink-0 items-center justify-center text-text-tertiary"
          >
            <Search className="h-[15px] w-[15px]" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-text-secondary group-hover:text-text-primary">
            Search
          </span>
          <span
            className="shrink-0 rounded border px-[5px] py-px font-mono text-[10.5px] text-text-tertiary"
            style={{ borderColor: 'var(--border-bright)' }}
          >
            ⌘K
          </span>
        </button>
      </div>

      {/* ALL scope */}
      <div className="px-2.5">
        <button
          type="button"
          onClick={() => {
            navigate('/console');
          }}
          title="All projects"
          aria-label="All projects"
          aria-pressed={allSelected}
          className={`relative flex w-full items-center gap-[10px] rounded-[7px] px-2.5 py-[5px] text-left text-[13px] transition-colors ${
            allSelected
              ? 'bg-surface-hover font-medium text-text-primary'
              : 'font-normal text-text-secondary hover:bg-surface-hover hover:text-text-primary'
          }`}
        >
          <span aria-hidden className="flex h-[17px] w-[17px] shrink-0 items-center justify-center">
            <Inbox className="h-[15px] w-[15px]" />
          </span>
          <span className="min-w-0 flex-1 truncate">All projects</span>
          <GlobalRunning />
        </button>
      </div>

      {/* Grouped project list */}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-3 pt-1">
        {error !== undefined ? (
          <span
            title={error.message}
            className="mx-2 rounded border border-error/40 bg-error/10 px-2 py-1 font-mono text-[10px] text-error"
          >
            {error.message}
          </span>
        ) : null}
        {/* Column headers. Same geometry as a row's cells, so the glyphs sit
            exactly above the numbers they name. Rendered once, above a FLAT
            list: owner group headers and a hand-sorted order cannot both be
            true, and the order you choose is the more useful of the two. */}
        {flat.length > 0 ? (
          <div className="flex items-center gap-[10px] px-2.5 pb-1 pt-1.5">
            <span className="h-[17px] w-[17px] shrink-0" />
            <span className="min-w-0 flex-1" />
            <ProjectCountHeader />
          </div>
        ) : null}
        {flat.map(p => (
          <ProjectRow
            key={p.id}
            project={p}
            selected={scope === p.id}
            onClick={() => {
              navigate(`/console/p/${p.id}`);
            }}
            onRemove={() => {
              void handleRemove(p.id);
              if (scope === p.id) navigate('/console');
            }}
            onEditEnv={() => {
              setEnvProject(p);
            }}
          />
        ))}
        {flat.length === 0 && error === undefined ? (
          <div className="px-3 py-6 text-center text-[12.5px] text-text-tertiary">
            No projects match “{query}”.
          </div>
        ) : null}
      </div>

      {/* Add project */}
      <div className="border-t border-border p-3">
        <button
          type="button"
          onClick={onAddProject}
          title="Add project"
          aria-label="Add project"
          className="flex w-full items-center gap-2.5 rounded-[10px] border border-border bg-surface px-3 py-2.5 text-left text-[13px] font-semibold text-text-secondary transition-colors hover:border-accent-bright/50 hover:bg-surface-hover hover:text-text-primary"
        >
          <span aria-hidden="true" className="text-base leading-none text-accent-bright">
            +
          </span>
          <span>Add project</span>
        </button>
      </div>

      {/* Nav menu — under Add project, separated from it by the border-t divider. */}
      <div className="flex flex-col gap-0.5 border-t border-border px-2.5 py-2">
        <RailNavLink
          to="/console/builder"
          icon={PenTool}
          label="Workflow Builder"
          title="Visual workflow builder (beta)"
          badge="beta"
        />
        <RailNavLink
          to="/console/settings"
          icon={Settings}
          label="Settings"
          title="Settings ( , )"
        />
      </div>

      {/* Resize handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize"
        onPointerDown={startResize}
        className="group absolute -right-1 top-0 z-10 flex h-full w-[9px] cursor-col-resize items-center justify-center"
      >
        <span
          aria-hidden
          className={`w-[2px] rounded-sm transition-all ${
            resizing
              ? 'h-full bg-accent-bright'
              : 'h-9 bg-transparent group-hover:h-14 group-hover:bg-accent-bright/60'
          }`}
        />
      </div>

      <EnvVarsDialog
        projectId={envProject?.id ?? ''}
        projectName={envProject?.name ?? ''}
        open={envProject !== null}
        onClose={() => {
          setEnvProject(null);
        }}
      />
    </nav>
  );
}
