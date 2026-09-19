import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import {
  byMostRecent,
  colorToken,
  conversationLabel,
  conversationMonogram,
  CONVERSATION_COLORS,
  matchesFilter,
  type ConversationColor,
  type ConversationSummary,
} from '../primitives/conversation';
import { relativeTime } from '../lib/format';
import { chooseNeighbourChat } from '../lib/last-chat';
import {
  applyChatOrder,
  dropIndexAt,
  previewShift,
  readChatOrder,
  reorder,
  rowBoxes,
  writeChatOrder,
  type RowBox,
} from '../lib/chat-order';

/** Which archived state the rail is showing. */
export type ArchiveScope = 'active' | 'archived' | 'all';

const SCOPES: readonly { value: ArchiveScope; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];

interface ConversationRailProps {
  conversations: ConversationSummary[];
  /** `null` while a new chat is pending — it exists only once the first message is sent. */
  activeConvId: string | null;
  onSelect: (id: string | null) => void;
  onRename: (id: string, title: string) => void;
  onRecolor: (ids: string[], color: ConversationColor | null) => void;
  /**
   * Archive or restore chats. `next` is the chat to open if archiving these
   * takes the page out of the one it is reading — the rail names it because
   * only the rail knows the displayed order.
   */
  onArchive: (ids: string[], archived: boolean, next: string | null) => void;
  /**
   * Open a chat's summary. The card shows only that one exists and how fresh
   * it is — the text itself is too long to sit in a rail without either
   * clamping it to uselessness or making every card a different height.
   */
  /** Which archived state the list is showing; the rail does not fetch. */
  scope: ArchiveScope;
  onScopeChange: (scope: ArchiveScope) => void;
  archivedCount: number;
  /** Which project's manual order to read and write. */
  projectId: string;
  /**
   * True while a new chat is pending. It has no row in the database until the
   * first message is sent, so the rail draws a placeholder — without one,
   * pressing New chat looked like it had done nothing.
   */
  pendingNew: boolean;
}

/**
 * A project's chats as a rail of cards, replacing the single-select switcher.
 *
 * Mirrors ProjectRail's language deliberately — monogram tile, filter box,
 * count pill, bordered selected row with a colored edge — so the two rails read
 * as one system rather than two components that happen to sit side by side.
 *
 * The selected card's edge takes the chat's own color rather than the brand
 * accent: a colored chat would otherwise show its color on the tile and a
 * different accent on the border, which reads as two unrelated signals.
 */
export function ConversationRail({
  conversations,
  activeConvId,
  onSelect,
  onRename,
  onRecolor,
  onArchive,
  scope,
  onScopeChange,
  archivedCount,
  pendingNew,
  projectId,
}: ConversationRailProps): ReactElement {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId !== null) renameRef.current?.focus();
  }, [renamingId]);

  // Bumped after a drop so the list re-reads the stored order.
  const [orderTick, setOrderTick] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);
  // Which row the cursor is over, and the row geometry as it stood when the
  // drag began. Both are needed to draw the preview; see `previewShift`.
  const [dropIndex, setDropIndex] = useState(-1);
  const boxesRef = useRef<RowBox[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  /**
   * The row whose handle is under the mouse.
   *
   * `draggable` is armed on mousedown over the monogram and disarmed the moment
   * the gesture ends, so a drag can only start from the handle. The alternative
   * — marking the handle itself draggable — drags the handle, and the card the
   * user is actually moving never leaves the list.
   */
  const [armed, setArmed] = useState<string | null>(null);

  // A press on the handle that never became a drag must not leave the row
  // draggable from anywhere on it.
  useEffect(() => {
    if (armed === null) return;
    const disarm = (): void => {
      setArmed(null);
    };
    window.addEventListener('mouseup', disarm);
    return (): void => {
      window.removeEventListener('mouseup', disarm);
    };
  }, [armed]);

  const visible = useMemo(() => {
    const byRecency = [...conversations].filter(c => matchesFilter(c, query)).sort(byMostRecent);
    return applyChatOrder(byRecency, readChatOrder(projectId));
    // orderTick is the dependency that matters after a drop; the read itself is
    // from localStorage, which useMemo cannot observe.
  }, [conversations, query, projectId, orderTick]);

  /** The gap between cards, kept in step with each row's `mb-0.5`. */
  const ROW_GAP = 2;

  const dragFrom = dragId === null ? -1 : visible.findIndex(c => c.id === dragId);

  const endDrag = (): void => {
    setDragId(null);
    setDropIndex(-1);
    setArmed(null);
    boxesRef.current = [];
  };

  const beginDrag = (id: string, index: number): void => {
    const rects = visible.map(c => {
      const el = rowRefs.current.get(c.id);
      const r = el?.getBoundingClientRect();
      return { top: r?.top ?? 0, bottom: r?.bottom ?? 0 };
    });
    boxesRef.current = rowBoxes(rects, ROW_GAP);
    scrollTopRef.current = scrollRef.current?.scrollTop ?? 0;
    setDragId(id);
    setDropIndex(index);
  };

  const onDropHere = (): void => {
    const target = visible[dropIndex];
    if (dragId !== null && target !== undefined && target.id !== dragId) {
      writeChatOrder(projectId, reorder(visible, dragId, target.id));
      setOrderTick(t => t + 1);
    }
    endDrag();
  };

  const commitRename = (id: string): void => {
    const next = draft.trim();
    const current = conversations.find(c => c.id === id);
    // An empty rename is a no-op, not a way to blank a title: a nameless row
    // cannot be told apart from any other in the list.
    if (next.length > 0 && current !== undefined && next !== conversationLabel(current)) {
      onRename(id, next);
    }
    setRenamingId(null);
  };

  const onRenameKey = (e: KeyboardEvent<HTMLInputElement>, id: string): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename(id);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setRenamingId(null);
    }
  };

  const toggle = (id: string): void => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const open = (id: string, additive: boolean): void => {
    // Additive click builds a selection; a plain click opens the chat and drops
    // the selection, which is the ordinary case and must stay one click.
    if (additive) {
      toggle(id);
      return;
    }
    setSelected(new Set());
    setMenuFor(null);
    onSelect(id);
  };

  const recolorTargets = (id: string): string[] =>
    selected.size > 0 && selected.has(id) ? [...selected] : [id];

  return (
    <aside
      className="flex h-full min-h-0 w-[268px] shrink-0 flex-col border-r border-border"
      aria-label="Chats"
      onClick={() => {
        setMenuFor(null);
      }}
    >
      <div className="flex items-center gap-2 px-3 pb-2 pt-3.5">
        <span className="font-mono text-[10.5px] font-bold tracking-[0.16em] text-text-tertiary">
          CHATS
        </span>
        <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[11px] text-text-secondary">
          {conversations.length}
        </span>
        <button
          type="button"
          onClick={() => {
            setSelected(new Set());
            onSelect(null);
          }}
          // Deliberately not gated on `busy`: a reply owed to another chat
          // still lands in that chat, so waiting for it buys nothing and makes
          // the project feel single-threaded when it is not.
          disabled={activeConvId === null}
          title={activeConvId === null ? 'Already on a new chat' : 'Start a new chat'}
          className="ml-auto rounded-full border px-2.5 py-[3px] font-mono text-[10px] tracking-[0.1em] text-text-secondary transition-colors hover:text-text-primary disabled:cursor-default disabled:opacity-40"
          style={{ borderColor: 'var(--border-bright)' }}
        >
          + NEW
        </button>
      </div>

      <div className="px-3 pb-2">
        <input
          value={query}
          onChange={e => {
            setQuery(e.target.value);
          }}
          placeholder="Filter chats…"
          aria-label="Filter chats"
          className="w-full rounded-[11px] border bg-[color:var(--surface-elevated)] px-3 py-2 text-[12.5px] text-text-primary placeholder:text-text-tertiary focus:outline-none"
          style={{ borderColor: 'var(--border)' }}
        />
      </div>

      <div className="flex gap-1.5 px-3 pb-2.5">
        {SCOPES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              onScopeChange(value);
            }}
            aria-pressed={scope === value}
            className={`rounded-full border px-2.5 py-[3px] font-mono text-[10px] tracking-[0.08em] transition-colors ${
              scope === value ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary'
            }`}
            style={{
              borderColor: scope === value ? 'var(--border-bright)' : 'var(--border)',
              background: scope === value ? 'var(--surface-elevated)' : 'transparent',
            }}
          >
            {label}
            {value === 'archived' && archivedCount > 0 ? ` ${String(archivedCount)}` : ''}
          </button>
        ))}
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        // The whole list answers the drag, not each row: rows slide under the
        // cursor during the preview, so a per-row hit test would report
        // whichever row had just moved into place rather than the one the user
        // is pointing at.
        onDragOver={e => {
          if (dragId === null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const scrolledBy = (scrollRef.current?.scrollTop ?? 0) - scrollTopRef.current;
          setDropIndex(dropIndexAt(boxesRef.current, e.clientY, scrolledBy));
        }}
        onDrop={e => {
          if (dragId === null) return;
          e.preventDefault();
          onDropHere();
        }}
      >
        {pendingNew ? (
          <div
            className="mb-0.5 flex items-center gap-2.5 rounded-[10px] border px-2.5 py-2"
            style={{
              borderColor: 'color-mix(in oklch, var(--brand-magenta), transparent 55%)',
              background: 'var(--surface-elevated)',
            }}
          >
            <span aria-hidden className="w-3.5 shrink-0" />
            <span
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-dashed font-mono text-[12px] font-bold text-text-tertiary"
              style={{ borderColor: 'var(--border-bright)' }}
            >
              +
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-text-primary">
                New chat
              </span>
              <span className="mt-[2px] block text-[11px] text-text-tertiary">
                Send a message to start it
              </span>
            </span>
          </div>
        ) : null}

        {visible.length === 0 && !pendingNew ? (
          <p className="px-2 py-3 text-[12px] text-text-tertiary">
            {conversations.length === 0 ? 'No chats yet.' : 'No chats match that filter.'}
          </p>
        ) : null}

        {visible.map((c, index) => {
          const token = colorToken(c.color);
          const isActive = c.id === activeConvId;
          const isSelected = selected.has(c.id);
          const shift =
            dragId === null ? 0 : previewShift(boxesRef.current, dragFrom, dropIndex, index);
          return (
            <div
              key={c.id}
              ref={el => {
                if (el === null) rowRefs.current.delete(c.id);
                else rowRefs.current.set(c.id, el);
              }}
              className={`group relative mb-0.5 flex items-start gap-2.5 rounded-[10px] border px-2.5 py-2 transition-[background-color,border-color,opacity,transform] duration-150 ${
                dragId === c.id ? 'opacity-40 ' : ''
              }${c.archived ? 'opacity-55 hover:opacity-100 ' : ''}${
                isSelected
                  ? 'bg-[color:color-mix(in_oklch,var(--brand-magenta),transparent_92%)]'
                  : isActive
                    ? 'bg-surface-elevated'
                    : 'hover:bg-surface-hover'
              }`}
              style={{
                borderColor: isActive
                  ? (token ?? 'var(--border-bright)')
                  : isSelected
                    ? 'color-mix(in oklch, var(--brand-magenta), transparent 60%)'
                    : 'transparent',
                // A transform, never a layout change: the geometry captured at
                // drag start has to stay true for the whole gesture.
                transform: shift === 0 ? undefined : `translateY(${String(shift)}px)`,
              }}
              draggable={armed === c.id && renamingId === null}
              onDragStart={e => {
                beginDrag(c.id, index);
                e.dataTransfer.effectAllowed = 'move';
                // Firefox refuses to start a drag without payload.
                e.dataTransfer.setData('text/plain', c.id);
              }}
              onDragEnd={() => {
                endDrag();
              }}
              onContextMenu={e => {
                e.preventDefault();
                setMenuFor(c.id);
              }}
            >
              {isActive ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -left-px bottom-2 top-2 w-[3px] rounded-r-[3px]"
                  style={{ background: token ?? 'var(--brand-magenta)' }}
                />
              ) : null}

              <button
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                aria-label={`Select ${conversationLabel(c)}`}
                onClick={e => {
                  e.stopPropagation();
                  toggle(c.id);
                }}
                className="mt-1.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[9px] text-white"
                style={{
                  borderColor: isSelected ? 'var(--brand-magenta)' : 'var(--border-bright)',
                  background: isSelected ? 'var(--brand-magenta)' : 'transparent',
                }}
              >
                {isSelected ? '✓' : ''}
              </button>

              {/* The monogram is the drag handle, and the only one. Dragging
                  from anywhere on the card made every stray press-and-move
                  across the rail a reorder. */}
              <span
                aria-hidden
                title="Drag to reorder"
                onMouseDown={() => {
                  setArmed(c.id);
                }}
                className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-lg border font-mono text-[12px] font-bold active:cursor-grabbing"
                style={{
                  background: token ?? 'var(--surface-elevated)',
                  borderColor: token ?? 'var(--border)',
                  color: token !== null ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {conversationMonogram(c)}
              </span>

              {renamingId === c.id ? (
                <input
                  ref={renameRef}
                  value={draft}
                  onChange={e => {
                    setDraft(e.target.value);
                  }}
                  onKeyDown={e => {
                    onRenameKey(e, c.id);
                  }}
                  onBlur={() => {
                    commitRename(c.id);
                  }}
                  maxLength={255}
                  aria-label="Rename chat"
                  className="w-full rounded border bg-surface px-1 py-0.5 text-[13px] text-text-primary focus:outline-none"
                  style={{ borderColor: 'var(--border-bright)' }}
                />
              ) : (
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      open(c.id, e.metaKey || e.ctrlKey || e.shiftKey);
                    }}
                    className="w-full text-left"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text-primary">
                        {conversationLabel(c)}
                      </span>
                      {c.lastActivityAt !== null ? (
                        <time
                          dateTime={c.lastActivityAt}
                          className="shrink-0 font-mono text-[10px] text-text-tertiary"
                        >
                          {relativeTime(c.lastActivityAt)}
                        </time>
                      ) : null}
                    </span>
                  </button>
                </div>
              )}

              {menuFor === c.id ? (
                <div
                  role="menu"
                  onClick={e => {
                    e.stopPropagation();
                  }}
                  className="absolute right-2 top-9 z-30 w-[188px] rounded-[11px] border p-[5px] shadow-[0_18px_44px_-18px_rgba(0,0,0,0.85)]"
                  style={{
                    borderColor: 'var(--border-bright)',
                    background: 'var(--surface-hover)',
                  }}
                >
                  {selected.size > 1 && selected.has(c.id) ? (
                    <div className="px-2.5 pb-1 pt-0.5 font-mono text-[9.5px] tracking-[0.12em] text-text-tertiary">
                      {selected.size} SELECTED
                    </div>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={selected.size > 1 && selected.has(c.id)}
                    onClick={() => {
                      setDraft(conversationLabel(c));
                      setRenamingId(c.id);
                      setMenuFor(null);
                    }}
                    className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-text-secondary hover:bg-surface-elevated hover:text-text-primary disabled:cursor-default disabled:opacity-40"
                  >
                    Rename…
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      const ids = recolorTargets(c.id);
                      onArchive(
                        ids,
                        !c.archived,
                        activeConvId !== null && ids.includes(activeConvId)
                          ? chooseNeighbourChat(visible, activeConvId, ids)
                          : null
                      );
                      setSelected(new Set());
                      setMenuFor(null);
                    }}
                    className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
                  >
                    {c.archived ? 'Restore' : 'Archive'}
                  </button>
                  <div className="my-1 h-px bg-border" />
                  <div className="px-2.5 pb-1 font-mono text-[9.5px] tracking-[0.14em] text-text-tertiary">
                    COLOR
                  </div>
                  <div className="flex flex-wrap gap-1.5 px-2.5 pb-1.5">
                    <button
                      type="button"
                      role="menuitem"
                      aria-label="No color"
                      title="No color"
                      onClick={() => {
                        onRecolor(recolorTargets(c.id), null);
                        setMenuFor(null);
                      }}
                      className="h-4 w-4 rounded-full border"
                      style={{ borderColor: 'var(--border-bright)' }}
                    />
                    {CONVERSATION_COLORS.map(({ value, label, token: swatch }) => (
                      <button
                        key={value}
                        type="button"
                        role="menuitem"
                        aria-label={label}
                        title={label}
                        onClick={() => {
                          onRecolor(recolorTargets(c.id), value);
                          setMenuFor(null);
                        }}
                        className="h-4 w-4 rounded-full border transition-transform hover:scale-110"
                        style={{
                          background: swatch,
                          borderColor:
                            c.color === value
                              ? 'var(--text-primary)'
                              : 'color-mix(in oklch, black, transparent 70%)',
                        }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
