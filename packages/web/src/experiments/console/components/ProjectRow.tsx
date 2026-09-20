import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ProjectGlyph } from '../lib/project-glyph';
import { getIdentity, resolveColor } from '../lib/project-identity';
import { ProjectCountCells } from './ProjectCountCells';
import { useDisplayName, setDisplayName } from '../lib/display-name';
import { formatProjectLocator } from '../lib/format';
import type { Project } from '../primitives/project';

interface ProjectRowProps {
  project: Project;
  selected: boolean;
  onClick: () => void;
  onRemove?: () => void;
  onEditEnv?: () => void;
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

function TrashIcon({ size = 15 }: { size?: number }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

/**
 * Rail row, design v2: monogram tile + repo-only title (the owner lives in
 * the group header above) + locator path + hover actions. Selection is the
 * gradient strip, gradient monogram, elevated background, and a LIVE pulse.
 * Double-click the title to rename; the path stays as a stable subtitle.
 */
export function ProjectRow({
  project,
  selected,
  onClick,
  onRemove,
  onEditEnv,
}: ProjectRowProps): ReactElement {
  const identity = getIdentity(project.id);
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
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      setDraft(displayName);
      inputRef.current?.select();
    }
  }, [editing, displayName]);

  // Close the ⋯ menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (): void => {
      setMenuOpen(false);
    };
    window.addEventListener('click', close);
    return (): void => {
      window.removeEventListener('click', close);
    };
  }, [menuOpen]);

  const commit = (): void => {
    if (draft.trim() === project.name) setDisplayName(project.id, '');
    else setDisplayName(project.id, draft);
    setEditing(false);
  };
  const cancel = (): void => {
    setEditing(false);
  };

  return (
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
      // Height pinned to the ICON, never to the contents. Anything that can
      // appear or disappear — the menu button, a count, a badge — would
      // otherwise decide how tall the row is, and the rail would reflow as you
      // move through it.
      className={`group relative flex h-[27px] w-full cursor-pointer items-center gap-[10px] rounded-[7px] px-2.5 py-[5px] text-left transition-colors ${
        selected ? 'bg-surface-hover' : 'bg-transparent hover:bg-surface-hover'
      }`}
    >
      {/* A bare coloured glyph. The tinted monogram square was decoration
          standing in for information the glyph already carries — six of them
          down the rail read as a column of swatches rather than a list of
          projects. Colour lives here now rather than on chats: a chat is read
          once, a project is navigated to for months. */}
      <span aria-hidden className="flex h-[17px] w-[17px] shrink-0 items-center justify-center">
        <ProjectGlyph projectId={project.id} glyph={identity.glyph} color={color} />
      </span>

      <div className="flex min-w-0 flex-1 items-center leading-[17px]">
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
            className={`truncate text-[13px] tracking-[-0.1px] ${
              selected
                ? 'font-medium text-text-primary'
                : 'font-normal text-text-secondary group-hover:text-text-primary'
            }`}
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
      <div
        className={`flex h-[17px] w-[19px] shrink-0 items-center justify-end transition-opacity ${
          menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
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
              // Sized to the ROW, not to a comfortable button. At 29px it set
              // the row's height — the content is a 17px glyph, and a control
              // that only appears on hover must not decide how tall every row
              // is when it is not there.
              className={`flex h-[19px] w-[19px] items-center justify-center rounded transition-colors hover:bg-surface-bright hover:text-text-primary ${
                menuOpen ? 'bg-surface-bright text-text-primary' : 'text-text-tertiary'
              }`}
            >
              <DotsIcon />
            </button>
            {menuOpen ? (
              <div
                role="menu"
                onClick={e => {
                  e.stopPropagation();
                }}
                className="absolute right-0 top-full z-30 mt-1 min-w-[178px] rounded-[11px] border bg-surface-hover p-[5px] shadow-[0_18px_44px_-18px_rgba(0,0,0,0.85)]"
                // Inline because the console scope's wildcard border-color
                // rule repaints Tailwind border utilities (see theme.css).
                style={{ borderColor: 'var(--border-bright)' }}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={e => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    const confirmed = window.confirm(
                      `Remove project "${displayName}"?\n\nLocal files and worktrees are not deleted.`
                    );
                    if (confirmed) onRemove();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-[11px] py-[9px] text-left text-[13px] font-semibold text-error transition-colors hover:bg-error/10"
                >
                  <TrashIcon />
                  Remove project
                </button>
                {onEditEnv !== undefined ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={e => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onEditEnv();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-[11px] py-[9px] text-left text-[13px] font-semibold text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                  >
                    Environment variables
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
