import { IdentityPicker } from './IdentityPicker';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ProjectGlyph } from '../lib/project-glyph';
import { openInIde, useIdeEnv } from '../lib/health';
import { getIdentity, resolveColor } from '../lib/project-identity';
import { ProjectCountCells } from './ProjectCountCells';
import { RowMenu } from './RowMenu';
import { useDisplayName, setDisplayName } from '../lib/display-name';
import { formatProjectLocator } from '../lib/format';
import type { Project } from '../primitives/project';

interface ProjectRowProps {
  project: Project;
  selected: boolean;
  onClick: () => void;
  onRemove?: () => void;
  onEditEnv?: () => void;
  /** Drag to arrange. Absent on surfaces that do not reorder. */
  dragging?: boolean;
  /** Preview offset in px while another row is being dragged past this one. */
  shift?: number;
  registerRow?: (el: HTMLElement | null) => void;
  onDragBegin?: () => void;
  onDragEnd?: () => void;
}

function DotsIcon({ size = 17 }: { size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  );
}

/**
 * Rail row, design v2: monogram tile + repo-only title (the owner lives in
 * the group header above) + locator path + hover actions. Selection is the
 * gradient strip, gradient monogram, elevated background, and a LIVE pulse.
 * Double-click the title to rename; the path stays as a stable subtitle.
 */
const MENU_ITEM =
  'flex w-full items-center gap-2.5 rounded-lg px-[11px] py-[9px] text-left text-[13px] font-semibold text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary';

export function ProjectRow({
  project,
  selected,
  onClick,
  onRemove,
  onEditEnv,
  dragging = false,
  shift = 0,
  registerRow,
  onDragBegin,
  onDragEnd,
}: ProjectRowProps): ReactElement {
  /** Bumped when the identity changes, to re-read it from localStorage. */
  const [identityTick, setIdentityTick] = useState(0);
  // localStorage is invisible to React, so the tick is what makes this re-read
  // after the picker writes. Referenced inside the factory rather than only in
  // the dependency list, so it is a real input and not a lint exception.
  const identity = useMemo(() => {
    // The tick is a cache-buster, not an input: localStorage is invisible to
    // React, so something has to tell this to re-read after the picker writes.
    void identityTick;
    return getIdentity(project.id);
  }, [project.id, identityTick]);
  const color = resolveColor(project.id, identity);
  const displayName = useDisplayName(project.id, project.name);
  // Group headers already show the owner — strip it from the row label
  // unless the user renamed the project (then show their name verbatim).
  const label =
    displayName === project.name && project.name.includes('/')
      ? project.name.slice(project.name.indexOf('/') + 1)
      : displayName;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayName);
  const [menuOpen, setMenuOpen] = useState(false);
  // The row element, kept in state rather than a ref so opening the menu has a
  // node to measure on the render it opens.
  const [rowEl, setRowEl] = useState<HTMLElement | null>(null);
  const closeMenu = useCallback((): void => {
    setMenuOpen(false);
  }, []);
  /**
   * Draggable only while the grip is under the pointer.
   *
   * A row that is draggable everywhere swallows text selection and makes a
   * plain click feel like the start of a drag; arming on the handle keeps the
   * rest of the row an ordinary button.
   */
  const ideEnv = useIdeEnv();
  const [armed, setArmed] = useState(false);
  /** Anchor rect for the identity picker, or null when it is closed. */
  const [pickerAt, setPickerAt] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      setDraft(displayName);
      inputRef.current?.select();
    }
  }, [editing, displayName]);

  const commit = (): void => {
    if (draft.trim() === project.name) setDisplayName(project.id, '');
    else setDisplayName(project.id, draft);
    setEditing(false);
  };
  const cancel = (): void => {
    setEditing(false);
  };

  return (
    <>
      <div
        onClick={editing || menuOpen ? undefined : onClick}
        onContextMenu={e => {
          if (onRemove === undefined || editing) return;
          e.preventDefault();
          setMenuOpen(true);
        }}
        role="button"
        tabIndex={editing ? -1 : 0}
        onKeyDown={e => {
          if (editing) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        aria-pressed={selected}
        title={`${displayName}\n${formatProjectLocator(project)}\n\nDouble-click to rename`}
        ref={el => {
          setRowEl(el);
          registerRow?.(el);
        }}
        draggable={armed && !editing && !menuOpen}
        onDragStart={e => {
          onDragBegin?.();
          e.dataTransfer.effectAllowed = 'move';
          // Firefox refuses to start a drag with no payload.
          e.dataTransfer.setData('text/plain', project.id);
        }}
        onDragEnd={() => {
          onDragEnd?.();
        }}
        style={{
          // A transform, never a layout change: the geometry captured at drag
          // start has to stay true for the whole gesture.
          transform: shift === 0 ? undefined : `translateY(${String(shift)}px)`,
          opacity: dragging ? 0.4 : undefined,
          transition: 'transform 150ms, opacity 150ms',
        }}
        className="rail-row group"
      >
        {/* A bare colored glyph. The tinted monogram square was decoration
          standing in for information the glyph already carries — six of them
          down the rail read as a column of swatches rather than a list of
          projects. Color lives here now rather than on chats: a chat is read
          once, a project is navigated to for months. */}
        {/* Six dots in the row's reserved left gutter, invisible until hover.
          The glyph is the project's identity and stays put — swapping it for a
          handle meant the one thing telling the rows apart disappeared exactly
          when you pointed at one. */}
        {onDragBegin !== undefined ? (
          <span
            aria-hidden
            className="rail-grip-dots"
            onMouseEnter={() => {
              setArmed(true);
            }}
            onMouseLeave={() => {
              setArmed(false);
            }}
          >
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        ) : null}

        <span aria-hidden className="rail-ico">
          <ProjectGlyph projectId={project.id} glyph={identity.glyph} color={color} />
        </span>

        <div className="rail-hide flex min-w-0 flex-1 items-center">
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              autoFocus
              onChange={e => {
                setDraft(e.target.value);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancel();
                }
                e.stopPropagation();
              }}
              onBlur={commit}
              onClick={e => {
                e.stopPropagation();
              }}
              onDoubleClick={e => {
                e.stopPropagation();
              }}
              className="w-full rounded border border-border-bright bg-surface px-1 py-0.5 text-[13px] font-medium text-text-primary focus:outline-none"
            />
          ) : (
            <span
              onDoubleClick={e => {
                e.stopPropagation();
                setEditing(true);
              }}
              className="rail-text tracking-[-0.1px]"
            >
              {label}
            </span>
          )}
        </div>

        {/* Counts as a TABLE, not a row of tokens: fixed-width cells so the eye
          reads DOWN a column instead of re-parsing each row, and blank for
          zero — an empty cell says "none" faster than a 0 does, and it stops
          the quiet projects shouting. */}
        <ProjectCountCells projectId={project.id} />

        {/* Hover actions: env vars + ⋯ menu. */}
        {/* The slot is always reserved and only its CONTENTS fade, so revealing
          the menu button can never reflow the row. The old version swapped a
          LIVE badge out for the buttons on the selected row, which is exactly
          the flicker that reads as jumpiness. */}
        <div className={`rail-hide rail-actions ${menuOpen ? '' : 'rail-reveal'}`}>
          {onRemove !== undefined ? (
            <div className="relative">
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  setMenuOpen(v => !v);
                }}
                title="More actions"
                aria-label="More actions"
                aria-expanded={menuOpen}
                className="rail-ibtn"
              >
                <DotsIcon />
              </button>
              <RowMenu
                anchor={rowEl}
                open={menuOpen}
                onClose={closeMenu}
                width={196}
                label={`Actions for ${displayName}`}
              >
                {/* The prototype's order: identity, then name, then the two things you
                    reach for occasionally, then the destructive one behind a rule. */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={e => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    const row = (e.currentTarget as HTMLElement).closest('.rail-row');
                    setPickerAt(row?.getBoundingClientRect() ?? null);
                  }}
                  className={MENU_ITEM}
                >
                  Change icon and color…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={e => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    setEditing(true);
                  }}
                  className={MENU_ITEM}
                >
                  Rename project
                </button>
                <div className="my-1 h-px bg-border" />
                {onEditEnv !== undefined ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={e => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onEditEnv();
                    }}
                    className={MENU_ITEM}
                  >
                    Environment variables…
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={e => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    openInIde(project.path, ideEnv);
                  }}
                  className={MENU_ITEM}
                >
                  Open in editor
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={e => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    const confirmed = window.confirm(
                      `Remove project "${displayName}"?\n\nLocal files and worktrees are not deleted.`
                    );
                    if (confirmed) onRemove?.();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-[11px] py-[9px] text-left text-[13px] font-semibold text-error transition-colors hover:bg-error/10"
                >
                  Remove project
                </button>
              </RowMenu>
            </div>
          ) : null}
        </div>
      </div>
      {pickerAt !== null ? (
        <IdentityPicker
          projectId={project.id}
          anchor={pickerAt}
          onChange={() => {
            setIdentityTick(t => t + 1);
          }}
          onClose={() => {
            setPickerAt(null);
          }}
        />
      ) : null}
    </>
  );
}
