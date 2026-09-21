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
import type { LiveEvent } from '../primitives/live-text';

interface ParsedEvent {
  type?: string;
  runId?: string;
  codebaseId?: string | null;
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
 * Subscribe to the dashboard SSE stream and invalidate the affected caches on
 * any lifecycle change.
 *
 * Mount it ONCE, at the root (ConsoleApp does). The server keeps a single
 * stream per id, so a second EventSource on `__dashboard__` evicts the first,
 * whose browser then reconnects and evicts the second — two mounts is not a
 * duplicate subscription, it is a reconnect loop.
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

    // Activity on a busy chat fires one notification per message, so the
    // refetch is coalesced the same way the per-conversation stream coalesces
    // streamed text. 120ms is below noticing and well above a burst.
    let convDirty: string | null | undefined;
    let convTimer: ReturnType<typeof setTimeout> | null = null;
    const flushConversations = (): void => {
      if (convTimer !== null) return;
      convTimer = setTimeout(() => {
        convTimer = null;
        // A known codebase invalidates just that project's lists; an unknown one
        // (a chat with no codebase) falls back to the prefix, which fans out to
        // every `conversations:*` key including the `:archived-count` variants.
        if (typeof convDirty === 'string' && convDirty !== '') {
          invalidate(K.conversations(convDirty));
        } else {
          invalidate('conversations');
        }
        invalidate('projectCounts');
        convDirty = undefined;
      }, 120);
    };

    es.onmessage = (e: MessageEvent<string>): void => {
      const ev = parse(e.data);
      if (ev?.type === undefined || ev.type === 'heartbeat') return;
      if (ev.type === 'conversation_lock') {
        // Read as a trigger, never as state: /api/health is the authority on
        // which chats are working, and it merges in background workflows that
        // never touch the conversation lock at all.
        invalidate(K.activeChats);
        // A turn beginning or ending also moves the chat's last-activity stamp
        // and its position in the rail. On Postgres `conversation_changed`
        // says so as well; on SQLite there are no triggers, so this is the
        // only push the list gets. The event carries no codebase, so the
        // debounced flush widens to the prefix.
        convDirty = null;
        flushConversations();
        return;
      }
      if (ev.type === 'workflow_status' || ev.type === 'dag_node') {
        // Refetch every runs:* key (runs:all, runs:project:<id>).
        invalidate('runs');
        // A background workflow holds no conversation lock, so the active-chat
        // list changes with the RUN rather than with a lock event.
        invalidate(K.activeChats);
        // The rail's own numbers live under a separate key, so they need
        // naming here or they would freeze while the runs feed stayed live.
        invalidate('projectCounts');
        // Also refresh any open run-detail cache so the detail page picks
        // up status / node-transition changes without its own SSE round-trip.
        if (typeof ev.runId === 'string') {
          invalidate(K.run(ev.runId));
        }
        return;
      }
      if (ev.type === 'conversation_changed') {
        // Two notifications for different projects inside one debounce window
        // must not let the second one narrow the first. Widen to the prefix.
        convDirty = convDirty === undefined || convDirty === ev.codebaseId ? ev.codebaseId : null;
        flushConversations();
      }
    };

    // A RECONNECT is a hole in the record. Everything the server emitted while
    // the socket was down is gone — there is no replay — and nothing in the
    // cache knows it missed anything, so the rail would keep showing whatever
    // it last heard about, indefinitely and confidently. Refetching the keys
    // this stream keeps live is the only honest response to a gap.
    //
    // The FIRST open is skipped: mount already fetched, and invalidating there
    // would double every request on every page load.
    let reconnect = false;
    es.onopen = (): void => {
      if (!reconnect) {
        reconnect = true;
        return;
      }
      invalidate('runs');
      invalidate('counts');
      invalidate('conversations');
      invalidate('projectCounts');
      invalidate(K.activeChats);
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

    let messagesDirty = false;
    let runDirty = false;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    // Coalesce bursts. Streamed text can arrive at >10Hz; we don't want a
    // refetch per chunk. 100ms is fast enough to feel live and slow enough
    // to dedupe.
    const scheduleFlush = (): void => {
      if (flushTimer !== null) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        if (messagesDirty) {
          invalidate(K.messages(conversationPlatformId));
          messagesDirty = false;
        }
        if (runDirty) {
          invalidate(K.run(runId));
          runDirty = false;
        }
      }, 100);
    };

    es.onmessage = (e: MessageEvent<string>): void => {
      const ev = parse(e.data);
      if (ev?.type === undefined || ev.type === 'heartbeat') return;

      switch (ev.type) {
        case 'text':
          messagesDirty = true;
          break;
        case 'tool_call':
        case 'tool_result':
          messagesDirty = true;
          runDirty = true;
          break;
        case 'workflow_status':
        case 'workflow_tool_activity':
        case 'dag_node':
        case 'workflow_step':
        case 'workflow_artifact':
        case 'workflow_dispatch':
          runDirty = true;
          break;
        // Other event types (system_status, retract, etc.) don't change
        // persisted state we render — ignore.
        default:
          return;
      }
      scheduleFlush();
    };

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

    let messagesDirty = false;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleFlush = (): void => {
      if (flushTimer !== null) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        if (messagesDirty) {
          invalidate(K.messages(conversationPlatformId));
          messagesDirty = false;
        }
      }, 100);
    };

    es.onmessage = (e: MessageEvent<string>): void => {
      const ev = parse(e.data);
      if (ev?.type === undefined || ev.type === 'heartbeat') return;

      switch (ev.type) {
        case 'text':
          // Render from the payload, then still refetch: the row that replaces
          // this preview is authoritative once it exists.
          if (typeof ev.content === 'string') {
            onLive?.({ kind: 'text', content: ev.content, category: ev.category ?? null });
          }
          messagesDirty = true;
          scheduleFlush();
          break;
        case 'tool_call':
          onLive?.({ kind: 'tool' });
          messagesDirty = true;
          scheduleFlush();
          break;
        case 'tool_result':
          messagesDirty = true;
          scheduleFlush();
          break;
        case 'retract':
          // The orchestrator withdrew its streamed prose (it turned out to be a
          // workflow dispatch). Drop the preview or it outlives the text.
          onLive?.({ kind: 'retract' });
          break;
        case 'conversation_lock':
          if (typeof ev.locked === 'boolean') onLockChange?.(ev.locked);
          break;
        // No run-detail cache here; ignore workflow_* and everything else.
        default:
          return;
      }
    };

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
