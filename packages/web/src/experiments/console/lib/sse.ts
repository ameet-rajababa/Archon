/**
 * Console SSE wiring.
 *
 * Two streams are exposed by the server:
 *   /api/stream/__dashboard__       — multiplexed workflow events for every run
 *   /api/stream/<conversationId>    — per-conversation events (text/tool_call/tool_result + workflow_*)
 *
 * The console treats them as cache-invalidation triggers: an event lands,
 * the relevant cache key is invalidated, `useEntity` refetches authoritative
 * state from the API. The list+detail surfaces don't need to interpret event
 * payloads — they just need to know "data changed, ask again." This stays
 * loosely coupled to event schemas and avoids partial in-memory mutation.
 *
 * Two events carry their answer instead, and both are here because a refetch
 * CANNOT produce it: streamed assistant text (`onLive`, whose rows are written
 * late — see primitives/live-text), and tool activity, whose authority is a Map
 * in the server's memory rather than a row. See primitives/live-activity.
 */

import { useEffect } from 'react';
import { invalidate, patch } from '../store/cache';
import { K } from './../store/keys';
import { SSE_BASE_URL } from './http';
import type { LiveEvent } from '../primitives/live-text';
import { applyActivity, clearActivity, toActivityEvent } from '../primitives/live-activity';
import type { ActiveChats } from '../skills/activeChats';

interface ParsedEvent {
  type?: string;
  runId?: string;
  codebaseId?: string | null;
  conversationId?: string;
  locked?: boolean;
  content?: string;
  category?: string;
}

function parse(raw: string): ParsedEvent | null {
  try {
    return JSON.parse(raw) as ParsedEvent;
  } catch {
    return null;
  }
}

/**
 * The slice of `EventSource` {@link recoverOnReconnect} touches: a writable
 * `onopen` slot. Narrow enough that a test can drive the open lifecycle
 * directly, which matters here — the console has no DOM under the test runner.
 */
export interface OpenableStream {
  onopen: ((ev: Event) => void) | null;
}

/**
 * Refetch the cache keys a stream keeps live, once that stream has reconnected.
 *
 * A reconnect is a hole in the record. EventSource replays nothing, so every
 * event the server emitted while the socket was down is gone, and no cache
 * entry knows it missed any — the view goes on showing what it last heard,
 * indefinitely and confidently. Refetching what the stream feeds is the only
 * honest response to a gap.
 *
 * The FIRST open is skipped: the mount that opened the stream already fetched
 * these keys, and invalidating there would double every request on page load.
 *
 * A plain function rather than a hook, so the skip-first-open lifecycle is
 * unit-testable — the same extraction shape as `subscribeKey` in store/cache.
 */
export function recoverOnReconnect(es: OpenableStream, keys: readonly string[]): void {
  let opened = false;
  es.onopen = (): void => {
    if (!opened) {
      opened = true;
      return;
    }
    for (const key of keys) invalidate(key);
  };
}

/**
 * What each stream event changes, named per stream rather than as a cache key.
 *
 * `onmessage` marks the targets of the event it just received, and the stream's
 * reconnect key list is the union of the same table's targets resolved through
 * the same per-stream key map. The live-event path and the recovery path
 * therefore cannot name different keys: an event type added to a table is
 * recovered on reconnect for free, and a target added to a union is a type error
 * until {@link conversationStreamTargetKeys} / {@link runStreamTargetKeys} give
 * it a key. Restating the union by hand is how a reconnect silently
 * under-invalidates.
 */
type ConversationTarget = 'messages';
type RunTarget = ConversationTarget | 'run';

const CONVERSATION_EVENT_TARGETS = new Map<string, readonly ConversationTarget[]>([
  ['text', ['messages']],
  ['tool_call', ['messages']],
  ['tool_result', ['messages']],
]);

const RUN_EVENT_TARGETS = new Map<string, readonly RunTarget[]>([
  ['text', ['messages']],
  ['tool_call', ['messages', 'run']],
  ['tool_result', ['messages', 'run']],
  ['workflow_status', ['run']],
  ['workflow_tool_activity', ['run']],
  ['dag_node', ['run']],
  ['workflow_step', ['run']],
  ['workflow_artifact', ['run']],
  ['workflow_dispatch', ['run']],
]);

type DashboardTarget = 'runs' | 'runCounts' | 'conversations' | 'projectCounts' | 'activeChats';

/**
 * What the dashboard stream's events change.
 *
 * `conversation_activity` is listed even though the live path PATCHES rather
 * than refetching it: the table names what an event changes, and recovery
 * always refetches because the payloads that would have been patched in are
 * exactly what a reconnect lost.
 */
const DASHBOARD_EVENT_TARGETS = new Map<string, readonly DashboardTarget[]>([
  ['conversation_activity', ['activeChats']],
  ['conversation_lock', ['activeChats', 'conversations', 'projectCounts']],
  ['workflow_status', ['runs', 'runCounts', 'activeChats', 'projectCounts']],
  ['dag_node', ['runs', 'runCounts', 'activeChats', 'projectCounts']],
  ['conversation_changed', ['conversations', 'projectCounts']],
]);

function conversationStreamTargetKeys(
  conversationPlatformId: string
): Record<ConversationTarget, string> {
  return { messages: K.messages(conversationPlatformId) };
}

function runStreamTargetKeys(
  conversationPlatformId: string,
  runId: string
): Record<RunTarget, string> {
  return { messages: K.messages(conversationPlatformId), run: K.run(runId) };
}

function liveKeys<T extends string>(
  eventTargets: ReadonlyMap<string, readonly T[]>,
  targetKeys: Readonly<Record<T, string>>
): string[] {
  return [...new Set([...eventTargets.values()].flat())].map(target => targetKeys[target]);
}

/**
 * Prefixes, not concrete keys, for the three families: this stream is
 * multiplexed across every project, so it has no single id to name. `runs`
 * fans out to `runs:all` and every `runs:project:<id>`; `projectCounts` to
 * every row's numbers; `conversations` to every project's list.
 *
 * `run:<id>` is deliberately absent. A reconnect cannot know which runs moved
 * while the socket was down, and an open run detail page recovers its own key
 * through {@link useRunStreamSSE}, which does know.
 */
function dashboardStreamTargetKeys(): Record<DashboardTarget, string> {
  return {
    runs: 'runs',
    runCounts: K.countsGlobal,
    conversations: 'conversations',
    projectCounts: 'projectCounts',
    activeChats: K.activeChats,
  };
}

/** The cache keys {@link useDashboardSSE} keeps live. */
export function dashboardStreamKeys(): string[] {
  return liveKeys(DASHBOARD_EVENT_TARGETS, dashboardStreamTargetKeys());
}

/** The cache keys {@link useConversationSSE} keeps live. */
export function conversationStreamKeys(conversationPlatformId: string): string[] {
  return liveKeys(CONVERSATION_EVENT_TARGETS, conversationStreamTargetKeys(conversationPlatformId));
}

/** The cache keys {@link useRunStreamSSE} keeps live. */
export function runStreamKeys(conversationPlatformId: string, runId: string): string[] {
  return liveKeys(RUN_EVENT_TARGETS, runStreamTargetKeys(conversationPlatformId, runId));
}

/**
 * Subscribe to the dashboard SSE stream and invalidate the affected caches on
 * any lifecycle change.
 *
 * Safe to mount from more than one place — ConsoleApp mounts it at the root
 * and ChatRunsPanel mounts it again. Each opens an independent connection and
 * the invalidations are idempotent, so the duplicate costs a socket and a
 * redundant refetch, nothing more.
 *
 * It was NOT always safe: the server held one writer per stream id, so two
 * subscribers on `__dashboard__` evicted each other in a reconnect loop.
 * `SSETransport.streams` is a Set per id now, and retires a writer when it
 * aborts, when a write to it fails, or via the zombie reaper — never because
 * someone else connected. Check that before reintroducing a mount-once rule.
 *
 * Events we care about:
 *   workflow_status      — run created / status changed / completed / failed
 *   dag_node             — active-node lifecycle changes, rendered together on
 *                          each ActiveRunCard
 *   conversation_changed — a chat created, renamed, archived, recolored, or
 *                          touched by new activity (Postgres only)
 *   conversation_lock    — a chat started or stopped working. This is what
 *                          makes "working" live across the whole console
 *                          rather than up to one poll interval stale.
 */
export function useDashboardSSE(): void {
  useEffect(() => {
    // Use SSE_BASE_URL so dev bypasses the Vite proxy (which buffers SSE).
    const es = new EventSource(`${SSE_BASE_URL}/api/stream/__dashboard__`);

    const targetKeys = dashboardStreamTargetKeys();

    /**
     * Invalidate what this event type changes, read from the same table the
     * reconnect key list is derived from. An override substitutes a narrower
     * key for a family — the conversation events know which project moved.
     */
    const invalidateTargets = (
      type: string,
      override?: Partial<Record<DashboardTarget, string>>
    ): void => {
      for (const target of DASHBOARD_EVENT_TARGETS.get(type) ?? []) {
        invalidate(override?.[target] ?? targetKeys[target]);
      }
    };

    // Activity on a busy chat fires one notification per message, so the
    // refetch is coalesced the same way the per-conversation stream coalesces
    // streamed text. 120ms is below noticing and well above a burst.
    let convDirty: string | null | undefined;
    // Which event types are waiting on the flush. A union rather than a
    // "widest wins" rule: a lock and a change inside one window each mean
    // their own targets, and the union is simply both.
    const convPending = new Set<string>();
    let convTimer: ReturnType<typeof setTimeout> | null = null;
    const flushConversations = (): void => {
      if (convTimer !== null) return;
      convTimer = setTimeout(() => {
        convTimer = null;
        // A known codebase invalidates just that project's lists; an unknown one
        // (a chat with no codebase) falls back to the family prefix, which fans
        // out to every `conversations:*` key including the `:archived-count`
        // variants.
        const narrowed =
          typeof convDirty === 'string' && convDirty !== ''
            ? { conversations: K.conversations(convDirty) }
            : undefined;
        for (const type of convPending) invalidateTargets(type, narrowed);
        convPending.clear();
        convDirty = undefined;
      }, 120);
    };

    es.onmessage = (e: MessageEvent<string>): void => {
      const ev = parse(e.data);
      if (ev?.type === undefined || ev.type === 'heartbeat') return;
      if (ev.type === 'conversation_activity') {
        // The one event applied rather than refetched — see live-activity.
        const activity = toActivityEvent(ev);
        if (activity !== null) {
          patch(K.activeChats, prev => applyActivity(prev as ActiveChats | undefined, activity));
        }
        return;
      }
      if (ev.type === 'conversation_lock') {
        // Read as a trigger, never as state: /api/health is the authority on
        // which chats are working, and it merges in background workflows that
        // never touch the conversation lock at all.
        invalidate(K.activeChats);
        // The turn is over, so whatever it was doing is over with it. Dropped
        // here as well as refetched because the refetch is a round trip, and
        // for its duration the row would go on naming a tool that has stopped.
        // Only the tool — the id stays for /api/health to rule on.
        if (ev.locked === false && typeof ev.conversationId === 'string') {
          const id = ev.conversationId;
          patch(K.activeChats, prev => clearActivity(prev as ActiveChats | undefined, id));
        }
        // A turn beginning or ending also moves the chat's last-activity stamp
        // and its position in the rail. On Postgres `conversation_changed`
        // says so as well; on SQLite there are no triggers, so this is the
        // only push the list gets. The event carries no codebase, so the
        // debounced flush widens to the prefix.
        convDirty = null;
        convPending.add('conversation_lock');
        flushConversations();
        return;
      }
      if (ev.type === 'workflow_status' || ev.type === 'dag_node') {
        // Every runs:* key, the global running pill, the active-chat list (a
        // background workflow holds no conversation lock, so that list changes
        // with the RUN rather than with a lock event) and the rail's own
        // numbers, which live under their own key and would otherwise freeze
        // while the runs feed stayed live.
        invalidateTargets(ev.type);
        // Also refresh any open run-detail cache so the detail page picks
        // up status / node-transition changes without its own SSE round-trip.
        // Per-event rather than a stream target: the id comes from the payload,
        // so a reconnect cannot name it (see dashboardStreamTargetKeys).
        if (typeof ev.runId === 'string') {
          invalidate(K.run(ev.runId));
        }
        return;
      }
      if (ev.type === 'conversation_changed') {
        // Two notifications for different projects inside one debounce window
        // must not let the second one narrow the first. Widen to the prefix.
        convDirty = convDirty === undefined || convDirty === ev.codebaseId ? ev.codebaseId : null;
        convPending.add('conversation_changed');
        flushConversations();
      }
    };

    recoverOnReconnect(es, dashboardStreamKeys());

    // EventSource auto-reconnects on transient errors; we only surface a
    // warn when the connection has permanently closed so dropped streams
    // aren't completely silent (the 30s safety-net poll in RunDetailPage
    // covers the actual recovery; this is purely an observability hook).
    es.onerror = (): void => {
      if (es.readyState === EventSource.CLOSED) {
        console.warn('[console-sse] dashboard stream closed');
      }
    };

    return (): void => {
      if (convTimer !== null) clearTimeout(convTimer);
      es.close();
    };
  }, []);
}

/**
 * Subscribe to a single run's conversation stream and invalidate the detail
 * caches on every interesting event. Skips connecting until a platform
 * conversation id is known.
 *
 * Events we care about:
 *   text                  — new assistant text → messages changed
 *   tool_call/tool_result — new tool activity  → messages + run events changed
 *   workflow_status       — run status changed
 *   workflow_tool_activity / dag_node — workflow_events table grew
 */
export function useRunStreamSSE(conversationPlatformId: string | null, runId: string | null): void {
  useEffect(() => {
    if (conversationPlatformId === null || runId === null) return;

    const es = new EventSource(
      `${SSE_BASE_URL}/api/stream/${encodeURIComponent(conversationPlatformId)}`
    );

    const targetKeys = runStreamTargetKeys(conversationPlatformId, runId);
    const dirty = new Set<RunTarget>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    // Coalesce bursts. Streamed text can arrive at >10Hz; we don't want a
    // refetch per chunk. 100ms is fast enough to feel live and slow enough
    // to dedupe.
    const scheduleFlush = (): void => {
      if (flushTimer !== null) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        for (const target of dirty) invalidate(targetKeys[target]);
        dirty.clear();
      }, 100);
    };

    es.onmessage = (e: MessageEvent<string>): void => {
      const ev = parse(e.data);
      if (ev?.type === undefined || ev.type === 'heartbeat') return;

      // An event absent from the table (system_status, retract, etc.) doesn't
      // change persisted state we render.
      const targets = RUN_EVENT_TARGETS.get(ev.type);
      if (targets === undefined) return;
      for (const target of targets) dirty.add(target);
      scheduleFlush();
    };

    recoverOnReconnect(es, runStreamKeys(conversationPlatformId, runId));

    es.onerror = (): void => {
      if (es.readyState === EventSource.CLOSED) {
        console.warn('[console-sse] conversation stream closed', { conversationPlatformId });
      }
    };

    return (): void => {
      if (flushTimer !== null) clearTimeout(flushTimer);
      es.close();
    };
  }, [conversationPlatformId, runId]);
}

/**
 * Subscribe to a conversation stream for a pure chat view (no associated run).
 * Identical to {@link useRunStreamSSE} minus the run-detail branches: it only
 * invalidates the message cache on text/tool events, and surfaces the
 * conversation lock so the composer can disable while the agent is responding.
 *
 *   text / tool_call / tool_result → messages changed (debounced refetch)
 *   conversation_lock              → onLockChange(locked)
 *   text / tool_call / retract     → onLive(event), for the streamed preview
 *
 * `onLive` exists because the refetch alone cannot show a reply as it arrives:
 * the server buffers assistant text in memory and writes the rows late (see
 * `primitives/live-text.ts`), so the invalidation it triggers reads a database
 * that does not have the text yet. The event already carries the text, so the
 * payload is handed to the caller as well as being used as a refetch trigger.
 */
export function useConversationSSE(
  conversationPlatformId: string | null,
  onLockChange?: (locked: boolean) => void,
  onLive?: (event: LiveEvent) => void
): void {
  useEffect(() => {
    if (conversationPlatformId === null) return;

    const es = new EventSource(
      `${SSE_BASE_URL}/api/stream/${encodeURIComponent(conversationPlatformId)}`
    );

    const targetKeys = conversationStreamTargetKeys(conversationPlatformId);
    const dirty = new Set<ConversationTarget>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleFlush = (): void => {
      if (flushTimer !== null) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        for (const target of dirty) invalidate(targetKeys[target]);
        dirty.clear();
      }, 100);
    };

    es.onmessage = (e: MessageEvent<string>): void => {
      const ev = parse(e.data);
      if (ev?.type === undefined || ev.type === 'heartbeat') return;

      // The lock drives the composer directly and has no cache entry, so it
      // stays out of the target table — and out of reconnect recovery with it.
      if (ev.type === 'conversation_lock') {
        if (typeof ev.locked === 'boolean') onLockChange?.(ev.locked);
        return;
      }

      // The live preview renders straight from the payload and never stands in
      // for the refetch below: the persisted row that supersedes it is
      // authoritative once it exists. `retract` is preview-only — the
      // orchestrator withdrew streamed prose that turned out to be a workflow
      // dispatch — and carries no target, so the table below invalidates
      // nothing for it, which is correct rather than an omission.
      switch (ev.type) {
        case 'text':
          if (typeof ev.content === 'string') {
            onLive?.({ kind: 'text', content: ev.content, category: ev.category ?? null });
          }
          break;
        case 'tool_call':
          onLive?.({ kind: 'tool' });
          break;
        case 'retract':
          onLive?.({ kind: 'retract' });
          break;
      }

      // No run-detail cache here; an event absent from the table (workflow_*
      // and everything else) changes nothing this stream renders.
      const targets = CONVERSATION_EVENT_TARGETS.get(ev.type);
      if (targets === undefined) return;
      for (const target of targets) dirty.add(target);
      scheduleFlush();
    };

    recoverOnReconnect(es, conversationStreamKeys(conversationPlatformId));

    es.onerror = (): void => {
      if (es.readyState === EventSource.CLOSED) {
        console.warn('[console-sse] conversation stream closed', { conversationPlatformId });
      }
    };

    return (): void => {
      if (flushTimer !== null) clearTimeout(flushTimer);
      es.close();
    };
  }, [conversationPlatformId, onLockChange, onLive]);
}
