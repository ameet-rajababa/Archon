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
 */

import { useEffect } from 'react';
import { invalidate } from '../store/cache';
import { K } from './../store/keys';
import { SSE_BASE_URL } from './http';

interface ParsedEvent {
  type?: string;
  runId?: string;
  locked?: boolean;
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

/** The cache keys {@link useConversationSSE} keeps live. */
export function conversationStreamKeys(conversationPlatformId: string): string[] {
  return liveKeys(CONVERSATION_EVENT_TARGETS, conversationStreamTargetKeys(conversationPlatformId));
}

/** The cache keys {@link useRunStreamSSE} keeps live. */
export function runStreamKeys(conversationPlatformId: string, runId: string): string[] {
  return liveKeys(RUN_EVENT_TARGETS, runStreamTargetKeys(conversationPlatformId, runId));
}

/**
 * Subscribe to the dashboard SSE stream and invalidate the runs feed on any
 * lifecycle change. Safe to mount from more than one route — RunsPage and the
 * ChatPage WorkflowDock both do; each opens an independent connection and the
 * invalidations are idempotent.
 *
 * Events we care about:
 *   workflow_status   — run created / status changed / completed / failed
 *   dag_node          — active-node lifecycle changes, rendered together on
 *                       each ActiveRunCard
 */
export function useDashboardSSE(): void {
  useEffect(() => {
    // Use SSE_BASE_URL so dev bypasses the Vite proxy (which buffers SSE).
    const es = new EventSource(`${SSE_BASE_URL}/api/stream/__dashboard__`);

    es.onmessage = (e: MessageEvent<string>): void => {
      const ev = parse(e.data);
      if (ev?.type === undefined || ev.type === 'heartbeat') return;
      if (ev.type === 'workflow_status' || ev.type === 'dag_node') {
        // Refetch every runs:* key (runs:all, runs:project:<id>).
        invalidate('runs');
        // Also refresh any open run-detail cache so the detail page picks
        // up status / node-transition changes without its own SSE round-trip.
        if (typeof ev.runId === 'string') {
          invalidate(K.run(ev.runId));
        }
      }
    };

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
 */
export function useConversationSSE(
  conversationPlatformId: string | null,
  onLockChange?: (locked: boolean) => void
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
  }, [conversationPlatformId, onLockChange]);
}
