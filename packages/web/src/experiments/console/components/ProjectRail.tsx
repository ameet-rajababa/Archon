import { Search, Inbox, Play, PanelLeft } from 'lucide-react';
import { useRailPeek } from '../lib/use-rail-peek';
import { applyManualOrder, dropIndexAt, previewShift, reorder, rowBoxes } from '../lib/chat-order';
import { readProjectOrder, writeProjectOrder } from '../lib/project-order';

/** Matches `margin-bottom: var(--row-gap)` on .rail-row at comfortable density. */
const PROJECT_ROW_GAP = 2;
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
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
      className="rail-hide rail-cnt"
      style={{ color: 'var(--running)' }}
    >
      <Play />
      {n} running
    </span>
  );
}

const RAIL_WIDTH_KEY = 'archon.console.railWidth';
const RAIL_COLLAPSED_KEY = 'archon.console.railCollapsed';
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

  /**
   * Collapsed to the icon column, and whether a peek is currently open.
   *
   * `showWide` is the one thing the inline width style keys off: while
   * collapsed-and-not-peeking the CSS owns the width (63px !important), and
   * an inline width would fight it. While peeking, the inline width is what
   * the panel animates TO.
   */
  /** Bumped on commit so the manual order is re-read from localStorage. */
  const [orderTick, setOrderTick] = useState(0);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(RAIL_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const peeking = useRailPeek(collapsed, width);
  const showWide = !collapsed || peeking;

  const toggleCollapsed = useCallback((): void => {
    setCollapsed(v => {
      const next = !v;
      try {
        localStorage.setItem(RAIL_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* private mode — the rail still collapses, it just does not persist */
      }
      return next;
    });
  }, []);

  // ⌘. / Ctrl+. anywhere. Not routed through the keymap because it must work
  // while focus is in the composer, where single-letter shortcuts are off.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === '.' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener('keydown', onKey);
    return (): void => {
      window.removeEventListener('keydown', onKey);
    };
  }, [toggleCollapsed]);
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
  const flat = useMemo(() => applyManualOrder(filtered, readProjectOrder()), [filtered, orderTick]);

  /* ── drag to arrange ────────────────────────────────────────────────────
     The same primitives the chat rail uses: geometry measured ONCE at drag
     start, a transform-only preview so the measurement stays true for the
     whole gesture, and an index-based commit so what lands matches what the
     preview showed. */
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const boxesRef = useRef<ReturnType<typeof rowBoxes>>([]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const scrollAtStart = useRef(0);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState(-1);
  const dragFrom = dragId === null ? -1 : flat.findIndex(p => p.id === dragId);

  const beginDrag = (id: string, index: number): void => {
    const rects = flat
      .map(p => rowRefs.current.get(p.id)?.getBoundingClientRect())
      .filter((r): r is DOMRect => r !== undefined);
    boxesRef.current = rowBoxes(rects, PROJECT_ROW_GAP);
    scrollAtStart.current = scrollerRef.current?.scrollTop ?? 0;
    setDragId(id);
    setDropIndex(index);
  };
  const endDrag = (): void => {
    setDragId(null);
    setDropIndex(-1);
  };
  const commitDrag = (): void => {
    const target = flat[dropIndex];
    if (dragId !== null && target !== undefined && target.id !== dragId) {
      writeProjectOrder(reorder(flat, dragId, target.id));
      // localStorage is invisible to useMemo; this is what makes it recompute.
      setOrderTick(t => t + 1);
    }
    endDrag();
  };

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
    <>
      {/* A collapsed rail is absolutely positioned over a spacer of its own
          width. That is what lets a peek widen it without pushing the content
          beside it — the page does not reflow, the panel slides over it. */}
      {collapsed ? <div className="rail-spacer" /> : null}
      <nav
        aria-label="Projects"
        style={{ width: showWide ? width : undefined, flexBasis: showWide ? width : undefined }}
        className={`rail-panel relative flex h-full shrink-0 flex-col border-r border-border bg-surface-inset${
          collapsed && !peeking ? ' is-collapsed' : ''
        }${peeking ? ' is-peeking' : ''}`}
      >
        {/* Header: brand + label + count + filter */}
        <div className="px-3.5 pb-2.5 pt-4">
          {/* The head is a ROW, on the same icon column as everything below it.
            Collapsed, the toggle is the only thing left and it has not moved —
            which is what makes the panel read as sliding rather than jumping. */}
          <button
            type="button"
            onClick={toggleCollapsed}
            title={`${collapsed ? 'Expand' : 'Collapse'}  ⌘.`}
            aria-label={collapsed ? 'Expand the rail' : 'Collapse the rail'}
            className="rail-row"
          >
            <span aria-hidden className="rail-ico" style={{ color: 'var(--text-secondary)' }}>
              <PanelLeft />
            </span>
            <span className="rail-hide brand-text text-base font-semibold tracking-tight">
              Archon
            </span>
          </button>
          {/* A ROW, not a text field. The box was permanent chrome for something
            done occasionally, and the palette already jumps to a project by
            name — across every project, not just the visible list. */}
          <button type="button" onClick={onSearch} title="Search  ⌘K" className="rail-row">
            <span aria-hidden className="rail-ico" style={{ color: 'var(--text-tertiary)' }}>
              <Search />
            </span>
            <span className="rail-hide rail-text">Search</span>
            <span
              className="rail-hide shrink-0 rounded border px-[5px] py-px font-mono text-[10.5px] text-text-tertiary"
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
            className="rail-row"
          >
            <span aria-hidden className="rail-ico">
              <Inbox />
            </span>
            <span className="rail-hide rail-text">All projects</span>
            <GlobalRunning />
          </button>
        </div>

        {/* Grouped project list */}
        <div
          ref={scrollerRef}
          className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-3 pt-1"
          onDragOver={e => {
            if (dragId === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            // The boxes were measured at drag start; if the list scrolled since,
            // the pointer has to be read in that same coordinate space.
            const scrolledBy = (scrollerRef.current?.scrollTop ?? 0) - scrollAtStart.current;
            setDropIndex(dropIndexAt(boxesRef.current, e.clientY, scrolledBy));
          }}
          onDrop={e => {
            if (dragId === null) return;
            e.preventDefault();
            commitDrag();
          }}
        >
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
            <>
              <div className="rail-sep" />
              {/* Always rendered, never `rail-hide`. Collapsed it is an empty
                row of its own height — reserving the space costs 18px of blank
                and buys a peek in which nothing below it moves. Only its CELLS
                hide, which is the prototype's own reading. */}
              <div className="rail-row is-header">
                <span className="rail-ico" />
                <span className="rail-text" />
                <ProjectCountHeader />
                <span className="rail-actions" />
              </div>
            </>
          ) : null}
          {flat.map((p, index) => (
            <ProjectRow
              key={p.id}
              project={p}
              dragging={dragId === p.id}
              shift={
                dragId === null ? 0 : previewShift(boxesRef.current, dragFrom, dropIndex, index)
              }
              registerRow={el => {
                if (el === null) rowRefs.current.delete(p.id);
                else rowRefs.current.set(p.id, el);
              }}
              onDragBegin={() => {
                beginDrag(p.id, index);
              }}
              onDragEnd={endDrag}
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
            <span className="rail-hide">Add project</span>
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
    </>
  );
}
