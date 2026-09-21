import { MessageCircle, Plus } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import {
  byArrangement,
  conversationLabel,
  matchesFilter,
  type ConversationSummary,
} from '../primitives/conversation';
import { relativeTime } from '../lib/format';
import {
  askAwaitingIds,
  awaitingReplyIds,
  chatStatus,
  STATUS_LABEL,
  STATUS_TITLE,
} from '../primitives/chat-status';
import { RowMenu } from './RowMenu';

import { chooseNeighbourChat } from '../lib/last-chat';
import {
  applyChatOrder,
  clearChatOrder,
  dropIndexAt,
  previewShift,
  readChatOrder,
  reorder,
  rowBoxes,
  type RowBox,
} from '../lib/chat-order';

/** Shared empty set, so an absent prop does not allocate one per row per render. */
const EMPTY_SET: ReadonlySet<string> = new Set();

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
  /**
   * Archive or restore chats. `next` is the chat to open if archiving these
   * takes the page out of the one it is reading — the rail names it because
   * only the rail knows the displayed order.
   */
  onArchive: (ids: string[], archived: boolean, next: string | null) => void;
  /**
   * Persist an arrangement: `ids` is the rail as displayed, top first.
   *
   * The rail says what it is showing and nothing more — it cannot see the
   * other archive scope, so it must not speak for it. The server rearranges
   * the named chats within the positions they already hold.
   */
  onReorder: (ids: string[]) => void;
  /**
   * Open a chat's summary. The card shows only that one exists and how fresh
   * it is — the text itself is too long to sit in a rail without either
   * clamping it to uselessness or making every card a different height.
   */
  /**
   * Chats the server is working on RIGHT NOW. A card carries a live dot while
   * it is in here, so you can tell from the rail that a chat you are not
   * looking at is still moving — and, just as importantly, that a still one
   * is genuinely idle rather than merely unobserved.
   */
  liveIds?: ReadonlySet<string>;
  /**
   * Chats with a run paused on an approval — your move, not the machine's.
   * Kept separate from `liveIds` because the two come from different places:
   * working is the server's conversation lock, awaiting belongs to a run.
   */
  awaitingIds?: ReadonlySet<string>;
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
  onArchive,
  onReorder,
  scope,
  onScopeChange,
  archivedCount,
  pendingNew,
  projectId,
  liveIds,
  awaitingIds,
}: ConversationRailProps): ReactElement {
  /* The filter box became nothing: a permanent text field for a list this
     short was chrome, and ⌘K already jumps to any chat by name. `query` stays
     empty so the filtering logic below is untouched and can be wired to the
     palette later without another rewrite. */
  const query = '';
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // Stable, because RowMenu holds it in a listener effect.
  const closeMenu = useCallback((): void => {
    setMenuFor(null);
  }, []);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // select(), not just focus(): a rename almost always replaces the title
    // rather than appending to it, so the existing text should be gone the
    // moment you type. ProjectRow has done this since it was written; the chat
    // rail only focused, which left the caret at one end and made every rename
    // a select-all first. Two renames in one app that behave differently is
    // the defect, not either behavior on its own.
    if (renamingId !== null) renameRef.current?.select();
  }, [renamingId]);

  /**
   * The arrangement just committed, held until the server's list agrees.
   *
   * The order lives on the rows, so the list has to come back before it can
   * show the new one. Without this the dropped card springs back to where it
   * was for as long as the round trip takes, which reads as a failed drag.
   */
  const [pending, setPending] = useState<string[] | null>(null);
  /** The last arrangement sent, so a re-render cannot send it twice. */
  const sentRef = useRef('');
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

  /** The list as the server has it arranged. */
  const arranged = useMemo(
    () => [...conversations].filter(c => matchesFilter(c, query)).sort(byArrangement),
    [conversations, query]
  );

  const visible = useMemo(
    () => (pending === null ? arranged : applyChatOrder(arranged, pending)),
    [arranged, pending]
  );

  /**
   * Two routes to one meaning. A paused gate belongs to a RUN and arrives as a
   * prop; an unanswered question belongs to the last MESSAGE and is read off
   * the conversation itself. A reader scanning the rail does not care which —
   * both say it is your move — so they merge before the mark is drawn.
   */
  const awaiting = useMemo(() => {
    const ids = askAwaitingIds(conversations);
    for (const id of awaitingIds ?? EMPTY_SET) ids.add(id);
    return ids;
  }, [conversations, awaitingIds]);

  // The server has caught up; stop overriding it. Anything else — a failed
  // write — leaves the arrangement on screen and the error on the page.
  /**
   * The third route, kept apart because it must rank BELOW working rather than
   * above it. A chat the agent merely spoke in last is your move too, but only
   * once the turn it was speaking in has ended.
   */
  const awaitingReply = useMemo(() => awaitingReplyIds(conversations), [conversations]);

  useEffect(() => {
    if (pending === null) return;
    const server = arranged.map(c => c.id);
    if (server.length === pending.length && server.every((id, i) => id === pending[i])) {
      setPending(null);
    }
  }, [arranged, pending]);

  /**
   * Give every chat on screen a position, the first time it is seen.
   *
   * A chat with no position is placed by recency, which is why a rail left
   * alone rearranged itself as replies landed and bumped `last_activity_at`.
   * Writing the position down on sight is what makes the order absolute: after
   * this pass nothing but a drag moves a row.
   *
   * This is also the one-time migration off localStorage. An arrangement made
   * before the order lived on the row is honoured if nothing here has been
   * placed yet, and the local copy is dropped once the server holds one —
   * server wins from then on, the same rule the project rail follows.
   */
  useEffect(() => {
    if (visible.length === 0) return;
    if (!visible.some(c => c.sortOrder === null)) {
      // Guarded, because this runs on every poll and only the first one has
      // anything to drop.
      if (readChatOrder(projectId).length > 0) clearChatOrder(projectId);
      return;
    }
    // Only when NOTHING is placed: a half-seeded rail would be fighting the
    // server with an order that predates it.
    const local = visible.every(c => c.sortOrder === null) ? readChatOrder(projectId) : [];
    const seed = (local.length > 0 ? applyChatOrder(visible, local) : visible).map(c => c.id);
    const key = seed.join(',');
    if (sentRef.current === key) return;
    sentRef.current = key;
    onReorder(seed);
  }, [visible, projectId, onReorder]);

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
      const next = reorder(visible, dragId, target.id);
      // Shown immediately, sent once. Recording it as sent also stops the
      // seeding effect above from answering the same render with a second,
      // contradictory arrangement.
      setPending(next);
      sentRef.current = next.join(',');
      onReorder(next);
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

  /**
   * Opening a chat is one click, always.
   *
   * Multi-select is gone: the design's row menu acts on the chat it belongs
   * to, and the only thing selection bought was bulk archive and bulk recolor
   * — one of which no longer exists. `additive` stays in the signature because
   * a modifier-click still means "not the ordinary case" and callers pass it;
   * it simply no longer builds a set.
   */
  const open = (id: string, _additive: boolean): void => {
    setMenuFor(null);
    onSelect(id);
  };

  return (
    <aside
      className="chatlist flex h-full min-h-0 shrink-0 flex-col"
      aria-label="Chats"
      onClick={() => {
        setMenuFor(null);
      }}
    >
      {/* Scope first, then New chat. No header row and no filter box: the
          header repeated the count the tab above already carries, and a
          permanent filter field for a list this short was chrome. */}
      <div className="chatlist-head">
        {SCOPES.map(({ value, label }) => {
          // Counts on Active and Archived, not on All.
          //   Archived is the one you cannot see — a count answers "is there
          //   anything in there?" without a click, which is the only reason to
          //   click it. Active agrees with the tab above by construction.
          //   All is not a set you are asking about; it is the absence of a
          //   filter, and its count is the sum of the two beside it.
          const count =
            value === 'active' ? conversations.length : value === 'archived' ? archivedCount : 0;
          return (
            <button
              key={value}
              type="button"
              onClick={() => {
                onScopeChange(value);
              }}
              aria-pressed={scope === value}
              className={`rounded-[6px] px-2 py-[3px] font-mono text-[10.5px] transition-colors ${
                scope === value
                  ? 'bg-surface-hover text-text-primary'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {label}
              {/* Zero renders blank, as in the rail table — an Archived chip
                  with no number says "nothing archived" by its silence. */}
              {count > 0 ? <span className="ml-1.5 text-text-tertiary">{count}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="px-2">
        <button
          type="button"
          onClick={() => {
            onSelect(null);
          }}
          // Deliberately not gated on `busy`: a reply owed to another chat
          // still lands in that chat, so waiting buys nothing and makes the
          // project feel single-threaded when it is not.
          disabled={activeConvId === null}
          title={activeConvId === null ? 'Already on a new chat' : 'Start a new chat'}
          className="newchat disabled:cursor-default disabled:opacity-40"
        >
          <Plus className="h-[13px] w-[13px]" />
          New chat
        </button>
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
          const isActive = c.id === activeConvId;
          const status = chatStatus(c.id, {
            working: liveIds ?? EMPTY_SET,
            awaiting,
            awaitingReply,
          });
          const shift =
            dragId === null ? 0 : previewShift(boxesRef.current, dragFrom, dropIndex, index);
          return (
            <div
              key={c.id}
              ref={el => {
                if (el === null) rowRefs.current.delete(c.id);
                else rowRefs.current.set(c.id, el);
              }}
              aria-current={isActive}
              className={`rail-row group ${dragId === c.id ? 'opacity-40 ' : ''}${
                c.archived ? 'opacity-55 hover:opacity-100' : ''
              }`}
              style={{
                // A transform, never a layout change: the geometry captured at
                // drag start has to stay true for the whole gesture.
                transform: shift === 0 ? undefined : `translateY(${String(shift)}px)`,
                transition: 'transform 150ms, opacity 150ms, background-color 110ms',
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
              {/* Six dots in the row's reserved gutter, invisible until hover
                  — the same handle the project rail uses, so reordering is one
                  gesture to learn rather than two. */}
              {renamingId !== c.id ? (
                <span
                  aria-hidden
                  title="Drag to reorder"
                  className="rail-grip-dots"
                  onMouseDown={() => {
                    setArmed(c.id);
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

              {/* Status on the LEFT, where the eye lands first on a list you
                  scan rather than read. Idle keeps the chat glyph — it is the
                  one state with nothing to announce, so the mark goes back to
                  saying what kind of row this is. */}
              <span aria-hidden title={STATUS_TITLE[status]} className={`chat-status is-${status}`}>
                {status === 'idle' ? <MessageCircle /> : <i />}
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
                  className="chat-rename"
                />
              ) : (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    open(c.id, e.metaKey || e.ctrlKey || e.shiftKey);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  {/* Two lines: the title wraps to two rather than being
                      truncated at a width the rail never had, and the
                      timestamp sits UNDER it instead of competing for the
                      same line. */}
                  <span className="rail-text">{conversationLabel(c)}</span>
                  {/* The word replaces the timestamp rather than crowding it:
                      "3m ago" is the wrong thing to read about a chat that is
                      moving right now, or waiting on you. */}
                  {status !== 'idle' ? (
                    <span className={`chat-stamp is-${status}`}>{STATUS_LABEL[status]}</span>
                  ) : c.lastActivityAt !== null ? (
                    <time dateTime={c.lastActivityAt} className="chat-stamp">
                      {relativeTime(c.lastActivityAt)}
                    </time>
                  ) : null}
                </button>
              )}

              <RowMenu
                anchor={rowRefs.current.get(c.id) ?? null}
                open={menuFor === c.id}
                onClose={closeMenu}
                width={188}
                label={`Actions for ${conversationLabel(c)}`}
              >
                <button
                  type="button"
                  role="menuitem"
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
                    const ids = [c.id];
                    onArchive(
                      ids,
                      !c.archived,
                      activeConvId !== null && ids.includes(activeConvId)
                        ? chooseNeighbourChat(visible, activeConvId, ids)
                        : null
                    );
                    setMenuFor(null);
                  }}
                  className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
                >
                  {c.archived ? 'Restore' : 'Archive'}
                </button>
              </RowMenu>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
