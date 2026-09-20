import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useParams } from 'react-router';
import { ChatStream } from '../components/ChatStream';
import { ChatComposer, type ChatDraft } from '../components/ChatComposer';
import { chooseOpenChat, readLastChat, writeLastChat } from '../lib/last-chat';
import { ConversationRail, type ArchiveScope } from '../components/ConversationRail';
import { WorkingIndicator } from '../components/WorkingIndicator';
import { WorkflowDock } from '../components/WorkflowDock';
import { EmptyState } from '../components/EmptyState';
import { StreamContextProvider } from '../lib/stream-context';
import { useConversationSSE } from '../lib/sse';
import { useEntity, invalidate } from '../store/cache';
import { K } from '../store/keys';
import { baselineUserIds, echoHasLanded } from '../primitives/pending-echo';
import { useFollowTail } from '../hooks/useFollowTail';
import { useArrowScroll } from '../hooks/useArrowScroll';
import * as skill from '../skills';
import type { Message } from '../primitives/message';
import {
  reduceLive,
  pendingSegments,
  type LiveSegment,
  type LiveEvent,
} from '../primitives/live-text';
import type { ConversationSummary } from '../primitives/conversation';

// While a turn is active, refetch messages on this cadence so streamed replies
// still surface if a per-conversation SSE event is dropped (cross-origin
// EventSource in dev can miss bursts). Mirrors RunDetailPage's safety-net poll.
const ACTIVE_POLL_MS = 3000;
// Consider the turn done once the trailing message is an assistant reply that
// has stayed stable this long. Independent of any SSE lock event.
const SETTLE_MS = 6000;
// Hard cap so a turn that never produces a reply (server error, etc.) can't
// disable the composer forever.
const MAX_WAIT_MS = 300_000;
// Refresh the CHAT LIST on this cadence while the tab is visible.
//
// Nothing else does. useConversationSSE invalidates only
// `messages:<the chat you are looking at>`; useDashboardSSE invalidates only
// `runs`, and is mounted on RunsPage and WorkflowDock, not here. The single
// `invalidate(K.conversations(...))` call site fires on local actions —
// archive, rename, recolour — so a reply landing in a chat you are NOT viewing,
// a title the agent rewrote, or a chat created by the CLI stayed invisible
// until a manual refresh.
//
// A poll rather than a stream because the server has no conversation-list
// event to subscribe to: `__dashboard__` carries workflow events only. Adding
// one is the better fix and a larger one; this removes the manual refresh
// today. Gated on visibility so a background tab costs nothing.
const LIST_POLL_MS = 8000;

/**
 * How often to ask which chats the server is working on.
 *
 * Faster than the list poll because this is the signal that says "moving" —
 * being four seconds late to show a live dot is the difference between the
 * rail looking trustworthy and looking asleep. The request is a single
 * `/api/health` read and is skipped entirely while the tab is hidden.
 */
const LIVE_POLL_MS = 4000;
/**
 * What Refresh sends. A visible user message rather than a silent back-channel:
 * the agent's summary tool writes to the chat's own record, so the request that
 * caused it should be readable in the transcript next to the result.
 */
/**
 * Project-scoped agent chat. A tab peer of the runs view under a project.
 *
 * MVP conversation model: one active conversation per project — the most-recent
 * web conversation, or created lazily on first send. No multi-conversation
 * sidebar yet (spike decision #3, deferred).
 *
 * Data flow mirrors RunDetailPage: load messages via useEntity(K.messages),
 * keep live via useConversationSSE (invalidate → refetch), render with the
 * shared MessageItem/ToolCallItem cards inside a StreamContextProvider.
 */
export function ChatPage(): ReactElement {
  const { projectId } = useParams<{ projectId: string }>();

  // Which archived state the rail is showing. Part of the cache key, or
  // switching scope would render the previous scope's list.
  const [scope, setScope] = useState<ArchiveScope>('active');
  const { data: conversations, error: conversationsError } = useEntity<ConversationSummary[]>(
    projectId !== undefined ? `${K.conversations(projectId)}:${scope}` : 'noop:no-project-convs',
    () =>
      projectId !== undefined ? skill.listConversations(projectId, scope) : Promise.resolve([])
  );

  // Counting archived chats needs its own read: the active list cannot know
  // how many it is leaving out.
  const { data: archivedList } = useEntity<ConversationSummary[]>(
    projectId !== undefined ? `${K.conversations(projectId)}:archived-count` : 'noop:no-archived',
    () =>
      projectId !== undefined ? skill.listConversations(projectId, 'archived') : Promise.resolve([])
  );

  // Active conversation: most-recent web conversation, else null until first send.
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  // Set when the user asks for a new chat. Without it the auto-select effect
  // below would immediately put them back in the most recent conversation, so
  // the button would appear to do nothing.
  const [startingNew, setStartingNew] = useState(false);
  // Switching project must release the previous project's conversation. The
  // auto-select effect below only fires when activeConvId is null, so without
  // this the page kept showing a chat belonging to the project just left.
  useEffect(() => {
    setActiveConvId(null);
    setStartingNew(false);
    setBusy(false);
    setPendingUser(null);
  }, [projectId]);

  useEffect(() => {
    if (activeConvId !== null || startingNew || projectId === undefined) return;
    const web = (conversations ?? []).filter(c => c.platformType === 'web');
    if (web.length === 0) return;
    // byMostRecent already ordered the list, so [0] is the newest.
    const open = chooseOpenChat(readLastChat(projectId), web);
    if (open !== null) setActiveConvId(open);
  }, [conversations, activeConvId, startingNew, projectId]);

  const selectConversation = (id: string | null): void => {
    setError(null);
    setStartingNew(id === null);
    setActiveConvId(id);
    // `busy` describes the conversation being read, not the page. Leaving it
    // set while switching made one chat's pending reply lock every other chat
    // in the project. The effect below re-derives it from the new
    // conversation's own trailing message, and the settle timer from the old
    // one must not outlive the switch.
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    settleSigRef.current = '';
    setBusy(false);
    // The echo belongs to the chat it was typed in, not to the page.
    setPendingUser(null);
    if (projectId !== undefined) writeLastChat(projectId, id);
  };

  const invalidateConversationsRef = useRef<() => void>(() => undefined);

  const invalidateConversations = (): void => {
    if (projectId === undefined) return;
    invalidate(`${K.conversations(projectId)}:${scope}`);
    invalidate(`${K.conversations(projectId)}:archived-count`);
    invalidate(K.conversations(projectId));
  };
  invalidateConversationsRef.current = invalidateConversations;

  // Keep the chat list fresh without a manual refresh. The ref keeps the
  // interval stable across renders: depending on the callback itself would tear
  // the timer down and rebuild it on every keystroke in the composer.
  useEffect(() => {
    if (projectId === undefined) return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      invalidateConversationsRef.current();
    }, LIST_POLL_MS);
    // Catch up immediately on returning to the tab rather than waiting out the
    // remainder of an interval that ran while it was hidden.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') invalidateConversationsRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return (): void => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [projectId]);

  const archiveConversations = (ids: string[], archived: boolean, next: string | null): void => {
    void (async (): Promise<void> => {
      try {
        for (const id of ids) {
          await skill.setConversationArchived(id, archived);
        }
        // Archiving the chat you are reading drops it out of the list the rail
        // shows, so the page must move — but to the neighbour the rail named,
        // not to a blank new chat. Being ejected to the composer after every
        // archive turns tidying a rail into a fight. Only the scope being
        // viewed matters: under `all` the chat stays listed either way, and
        // under `archived` it is restoring, not archiving, that removes it.
        const leavesList = scope === 'active' ? archived : scope === 'archived' ? !archived : false;
        if (leavesList && activeConvId !== null && ids.includes(activeConvId)) {
          selectConversation(next);
        }
        invalidateConversations();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Could not change the archive state.');
      }
    })();
  };

  const renameConversation = (id: string, title: string): void => {
    void (async (): Promise<void> => {
      try {
        await skill.renameConversation(id, title);
        invalidateConversations();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Rename failed.');
      }
    })();
  };

  const { data: messages, error: messagesError } = useEntity<Message[]>(
    activeConvId !== null ? K.messages(activeConvId) : 'noop:no-conv',
    () => (activeConvId !== null ? skill.listMessages(activeConvId) : Promise.resolve([]))
  );

  // `busy` = a reply is pending → composer disabled + recovery poll active.
  // Driven by message content and the send action, NOT by the SSE lock event,
  // so it stays correct even when the per-conversation SSE drops or never
  // connects (which it can, cross-origin in dev). SSE is a pure accelerator.
  const [busy, setBusy] = useState(false);
  // The user's own message, echoed the instant they send it rather than when
  // the server has stored it. Without this the first message of a new chat is
  // invisible for the whole create-and-upload round trip — the composer clears,
  // nothing takes its place, and a slow upload reads as a failed send. The echo
  // carries the attachments too, so the file chips appear with the text.
  const [pendingUser, setPendingUser] = useState<{
    content: string;
    files: Message['files'];
  } | null>(null);
  /**
   * The user-row IDs the conversation held when the echo was raised.
   *
   * Identity, not a count. Counting compared against a baseline read out of a
   * render closure, so a `messages` that was one refetch stale left the
   * baseline too high — the count then never exceeded it, the echo never
   * retired, and the message appeared twice with timestamps a second apart.
   * One of them was never a second message: only one row was ever persisted.
   *
   * An id that was not there before is unambiguous. It survives a stale read,
   * the same text being sent twice, and the new-chat id switch that empties the
   * list before the real row lands.
   */
  const pendingBaseRef = useRef<ReadonlySet<string>>(new Set());
  // Keyed by conversation — a pending chat has no id yet, so it gets its own
  // slot. Held in the composer this followed the user between chats.
  const [drafts, setDrafts] = useState<Record<string, ChatDraft>>({});
  // Keyed by project as well as conversation: ChatPage stays mounted across a
  // project switch, so a bare '__new__' slot was shared by every project and
  // text typed in one project's new chat surfaced in another's.
  const draftKey = `${projectId ?? '_'}:${activeConvId ?? '__new__'}`;
  const draft = drafts[draftKey] ?? { text: '', files: [] };
  const setDraft = (next: ChatDraft): void => {
    setDrafts(prev => ({ ...prev, [draftKey]: next }));
  };
  const [error, setError] = useState<string | null>(null);
  // Non-error advisory (distinct channel from `error` so it doesn't read as a
  // send failure) — e.g. files dropped from a first message.

  // Turn-completion state. The settle timer (below) is the correctness floor — it
  // works even when SSE is absent. The SSE lock event is a fast-path on top of it.
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleSigRef = useRef('');

  // SSE accelerator: invalidates the message cache on text/tool events, and via
  // onLockChange clears `busy` the instant the server releases the conversation
  // lock (conversation_lock:false) instead of waiting out SETTLE_MS. Must be
  // useCallback-stable — the hook's effect depends on it, so an inline lambda
  // would reconnect the EventSource on every render.
  const onLockChange = useCallback((locked: boolean): void => {
    if (locked) return;
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    setBusy(false);
  }, []);
  // Streamed text that has not been written to the database yet. The server
  // holds assistant text in memory and persists it late, so without this the
  // reply is invisible until a flush — the reload-to-see-it bug. See
  // `primitives/live-text.ts` for why persisting sooner is not the fix.
  const [liveSegments, setLiveSegments] = useState<LiveSegment[]>([]);
  const onLive = useCallback((event: LiveEvent): void => {
    setLiveSegments(prev => reduceLive(prev, event));
  }, []);

  useConversationSSE(activeConvId, onLockChange, onLive);

  // Switching chats must not carry one conversation's preview into another.
  useEffect(() => {
    setLiveSegments([]);
  }, [activeConvId]);

  // Derive turn state from the trailing message: a user message means a reply
  // is pending; once an assistant reply lands and stays stable for SETTLE_MS the
  // turn is done. This also recovers a reload mid-turn (trailing user message).
  useEffect(() => {
    const list = messages ?? [];
    const last = list[list.length - 1];
    if (last === undefined) return;
    if (last.role === 'user') {
      settleSigRef.current = '';
      if (settleTimerRef.current !== null) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      setBusy(true);
      return;
    }
    // Trailing message is an assistant/system reply. Arm the settle timer once;
    // re-arm only on real content change so identical poll refetches (same sig)
    // don't reset it forever.
    const sig = `${list.length}:${last.id}`;
    if (sig === settleSigRef.current) return;
    settleSigRef.current = sig;
    if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      setBusy(false);
    }, SETTLE_MS);
  }, [messages]);
  useEffect(
    () => (): void => {
      if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current);
    },
    []
  );

  // Retire the echo the moment the server's own copy of the message arrives.
  // Counting user rows rather than matching content: the same text sent twice
  // would otherwise clear the second echo against the first message's row.
  useEffect(() => {
    if (pendingUser === null) return;
    if (echoHasLanded(messages ?? [], pendingBaseRef.current)) setPendingUser(null);
  }, [messages, pendingUser]);

  // Belt and braces: an echo must never outlive its turn. If the reply has
  // landed and released the composer, whatever the echo was waiting for is
  // not coming — showing it alongside the stored message is the visible bug.
  useEffect(() => {
    if (!busy && pendingUser !== null) setPendingUser(null);
  }, [busy, pendingUser]);

  // Recovery poll: while a reply is pending, refetch messages on a cadence so a
  // dropped or absent SSE event can't hide the reply. Hard-caps at MAX_WAIT_MS.
  const busySinceRef = useRef(0);
  // Also held as state, because the working indicator needs to RENDER the
  // elapsed time and a ref changing does not re-render anything. Set once per
  // turn, so the clock counts from when the turn began rather than resetting
  // on every refetch.
  const [busySince, setBusySince] = useState<number | null>(null);
  useEffect(() => {
    if (!busy || activeConvId === null) {
      setBusySince(null);
      return;
    }
    const startedAt = Date.now();
    busySinceRef.current = startedAt;
    setBusySince(startedAt);
    const id = setInterval(() => {
      if (Date.now() - busySinceRef.current > MAX_WAIT_MS) {
        setBusy(false);
        return;
      }
      invalidate(K.messages(activeConvId));
    }, ACTIVE_POLL_MS);
    return (): void => {
      clearInterval(id);
    };
  }, [busy, activeConvId]);

  // Which chats the SERVER says it is working on — including ones you are not
  // looking at. Polled rather than pushed: the conversation lock lives in the
  // server's memory, so there is no row to hang a trigger on and no event to
  // subscribe to. Skipped entirely while the tab is hidden.
  const { data: liveChatIds } = useEntity<readonly string[]>(K.activeChats, skill.getActiveChatIds);
  useEffect(() => {
    const tick = (): void => {
      if (document.visibilityState === 'visible') invalidate(K.activeChats);
    };
    const id = setInterval(tick, LIVE_POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return (): void => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  const liveIds = useMemo(() => new Set(liveChatIds ?? []), [liveChatIds]);

  /**
   * Is THIS chat working? `busy` only knows about a turn this tab started, so
   * on a reload, in a second window, or on a chat driven from Slack or the
   * CLI, the indicator was absent while the agent was mid-tool — the screen
   * looked idle for the one reason it is never allowed to.
   *
   * The server's own answer covers those cases. `busy` still counts on its
   * own because it is true the instant a message is sent, before the next
   * health poll can notice.
   */
  const working = busy || (activeConvId !== null && liveIds.has(activeConvId));

  /**
   * When the clock starts.
   *
   * A turn this tab began has an exact start. One it did not — a reload, a
   * second window, a chat driven from Slack — has no knowable start, so the
   * clock counts from the last thing that was SAID instead. That is not a
   * guess dressed as precision: it is exactly the number worth reading during
   * a long silent stretch, because it is how long the silence has lasted.
   */
  const workingSince = useMemo<number | null>(() => {
    if (busySince !== null) return busySince;
    if (!working || activeConvId === null) return null;
    // Read from `conversations` rather than the `activeConversation` binding,
    // which is declared further down the component.
    const last = (conversations ?? []).find(c => c.id === activeConvId)?.lastActivityAt;
    if (last === null || last === undefined) return null;
    const t = Date.parse(last);
    return Number.isNaN(t) ? null : t;
  }, [busySince, working, activeConvId, conversations]);

  // Reveal the raw tool trace inline (toggled from the working indicator).
  const [showTools, setShowTools] = useState(false);

  // Follow the tail by observed height, not by message count: a streaming reply,
  // late markdown/code highlighting and expanding tool cards all grow an existing
  // row without adding one, and a count-keyed effect never sees them.
  const { scrollRef, contentRef, atBottom, scrollToBottom, scrollerProps, noteUserIntent } =
    useFollowTail();
  // ↑/↓ scroll the transcript. The composer re-focuses itself after each send,
  // so without this the arrows land in an empty textarea and do nothing.
  useArrowScroll(scrollRef, { onUserScroll: noteUserIntent });

  // Held in a ref so `onAnswer` below can be referentially stable without
  // threading every dependency of onSend through a useCallback. Memoized
  // message items compare this prop, so an inline lambda here would defeat
  // the memo entirely — the thing it is there to prevent.
  const onSendRef = useRef<(text: string, files?: File[]) => void>(() => undefined);

  const onSend = (text: string, files?: File[]): void => {
    if (projectId === undefined) return;
    setError(null);
    // The reader may be up in the history; their own message is the one thing
    // they always want to see land, so sending re-pins the tail.
    scrollToBottom();
    setLiveSegments([]); // a new turn — the previous reply is history now
    setBusy(true); // optimistic: disable the composer immediately
    // Show the message (and its attachments) before the request leaves.
    pendingBaseRef.current = baselineUserIds(messages ?? []);
    setPendingUser({
      content: text,
      files: (files ?? []).map(f => ({ name: f.name, mimeType: f.type, size: f.size })),
    });
    void (async (): Promise<void> => {
      try {
        if (activeConvId === null) {
          const conv = await skill.createConversation(projectId, text, files);
          setActiveConvId(conv.conversationId);
          setStartingNew(false);
          writeLastChat(projectId, conv.conversationId);
          invalidate(K.messages(conv.conversationId));
        } else {
          await skill.sendMessage(activeConvId, text, files);
          invalidate(K.messages(activeConvId));
        }
        // Sending can change the conversation list, not just its messages: a
        // new chat appears in it, and sending to an archived chat un-archives
        // it server-side. Without this the rail kept showing the chat as
        // archived and the count never moved.
        invalidateConversations();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Send failed.');
        setBusy(false); // unblock so the user can retry
        setPendingUser(null); // nothing was sent — the echo would be a lie
      }
      // On success `busy` stays true until the settle detector sees the reply.
    })();
  };

  if (projectId === undefined) {
    return <EmptyState title="No project selected." />;
  }

  const messageList = messages ?? [];
  const activeConversation = (conversations ?? []).find(c => c.id === activeConvId);
  // Which chat's summary is open, and whether it opened straight into the
  // editor. Keyed by conversation id rather than a boolean: the rail can open
  // the summary of a chat that is not the one being read.

  // Surface a failed (re)load of the conversation list or message history — a
  // revalidation can fail silently (network blip, server restart) and otherwise
  // leave stale/empty data with no signal. Send errors take precedence.
  const loadError = messagesError ?? conversationsError;

  // Current activity for the working indicator: the latest tool the agent
  // invoked in the in-flight turn (walk back to the last user message).
  // What actually renders: the persisted rows, followed by the streamed text
  // the database has not caught up with. Each preview disappears the moment its
  // real row lands, because `pendingSegments` slices by how many rows this turn
  // already has — no content comparison, and nothing to de-duplicate.
  const renderedMessages = useMemo<Message[]>(() => {
    const now = new Date().toISOString();
    // The user's echo sits after the stored rows and before any streamed reply,
    // which is the order it happened in.
    const withEcho =
      pendingUser === null
        ? messageList
        : [
            ...messageList,
            {
              id: 'pending-user',
              role: 'user' as const,
              content: pendingUser.content,
              timestamp: now,
              toolCalls: [],
              files: pendingUser.files,
              error: null,
              category: null,
              dispatch: null,
              workflowResult: null,
            },
          ];
    // Deliberately measured against `messageList`, not `withEcho`: the slice is
    // by how many *stored* rows this turn has, and the echo is not one.
    const pending = pendingSegments(liveSegments, messageList);
    if (pending.length === 0) return withEcho;
    return [
      ...withEcho,
      ...pending.map(
        (seg, i): Message => ({
          id: `live-${String(i)}`,
          role: 'assistant',
          content: seg.content,
          timestamp: now,
          toolCalls: [],
          files: [],
          error: null,
          category: seg.category,
          dispatch: null,
          workflowResult: null,
        })
      ),
    ];
  }, [messageList, liveSegments, pendingUser]);

  // The tool itself, input included — the indicator turns it into a sentence.
  // Passing only the name meant the line could say `Bash` and nothing more.
  onSendRef.current = onSend;

  /** Stable across renders; flips only between itself and `undefined`. */
  const answerAsk = useCallback((text: string): void => {
    onSendRef.current(text);
  }, []);

  const currentActivity = useMemo<{ name: string; input?: Record<string, unknown> } | null>(() => {
    for (let i = messageList.length - 1; i >= 0; i--) {
      const m = messageList[i];
      if (m === undefined) continue;
      if (m.role === 'user') break;
      if (m.role === 'assistant' && m.toolCalls.length > 0) {
        const call = m.toolCalls[m.toolCalls.length - 1];
        return call === undefined ? null : { name: call.name, input: call.input };
      }
    }
    return null;
  }, [messageList]);

  return (
    <section className="flex h-full min-h-0 flex-row">
      <ConversationRail
        // Remounted per project: the filter text, the selection and any open
        // menu all name chats in the project being left.
        key={projectId}
        conversations={conversations ?? []}
        liveIds={liveIds}
        activeConvId={activeConvId}
        onSelect={selectConversation}
        onRename={renameConversation}
        onArchive={archiveConversations}
        scope={scope}
        onScopeChange={setScope}
        archivedCount={archivedList?.length ?? 0}
        pendingNew={startingNew && activeConvId === null}
        projectId={projectId}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            {...scrollerProps}
            className="h-full overflow-y-auto px-[30px] pt-[26px] pb-[18px]"
          >
            {/* Match the composer's centered 940px column (design: .stream-inner) */}
            <div ref={contentRef} className="mx-auto max-w-[940px]">
              {renderedMessages.length === 0 && !working ? (
                <EmptyState
                  title={activeConvId === null ? 'New chat.' : 'No messages yet.'}
                  hint="Ask the agent about this project, or tell it what to run."
                />
              ) : (
                <StreamContextProvider value={{ runStartedAt: null }}>
                  <ChatStream
                    messages={renderedMessages}
                    showTools={showTools}
                    onAnswer={busy ? undefined : answerAsk}
                  />
                  {working ? (
                    <WorkingIndicator
                      activity={currentActivity}
                      since={workingSince}
                      expanded={showTools}
                      onToggle={() => {
                        setShowTools(v => !v);
                      }}
                    />
                  ) : null}
                </StreamContextProvider>
              )}
            </div>
          </div>
          {!atBottom ? (
            <button
              type="button"
              onClick={scrollToBottom}
              aria-label="Jump to bottom"
              className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface-elevated px-3 py-1 text-[11px] text-text-secondary shadow-md transition-colors hover:text-text-primary"
            >
              <span aria-hidden>↓</span>
              Jump to bottom
            </button>
          ) : null}
        </div>

        <WorkflowDock projectId={projectId} conversationDbId={activeConversation?.dbId ?? null} />

        {error !== null || loadError !== undefined ? (
          <div className="shrink-0 border-t border-error/30 bg-error/[0.06] px-6 py-2 font-mono text-[11px] text-error">
            {error ?? `Failed to load chat: ${loadError?.message ?? 'unknown error'}`}
          </div>
        ) : null}

        {/* Keyed by conversation: the composer holds its own in-flight text, so
            switching chats must remount it to reseed from that chat's draft. */}
        <ChatComposer
          key={draftKey}
          onSend={onSend}
          draft={draft}
          onDraftChange={setDraft}
          disabled={busy}
        />
      </div>
    </section>
  );
}
