import { createLogger } from '@archon/paths';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('adapter.web.transport');
  return cachedLog;
}

/**
 * Stream id of the multiplexed dashboard feed.
 *
 * Not a conversation: every client watching the console subscribes to it for
 * events that belong to no single chat — run lifecycle, chat-list changes, and
 * which conversations are currently working. Declared here, where streams are
 * owned, because five call sites spelling the same magic string is a pair that
 * has to be kept in agreement by hand.
 */
export const DASHBOARD_STREAM = '__dashboard__';

export interface SSEWriter {
  writeSSE(data: { data: string; event?: string; id?: string }): Promise<void>;
  close(): Promise<void>;
  readonly closed: boolean;
}

/** Grace period (ms) before firing onCleanup after stream removal. */
const RECONNECT_GRACE_MS = 5_000;

/**
 * Max time (ms) to hold buffered events waiting for a stream to connect.
 *
 * Must be ≥ RECONNECT_GRACE_MS — otherwise events emitted during a reconnect
 * window are dropped *before* the client has had a chance to reconnect, which
 * manifests as perpetually-spinning tool cards when a `tool_result` happens to
 * land in the gap. 60s covers typical EventSource auto-reconnect delays on
 * flaky networks (mobile, VPN, laptop sleep) without meaningfully growing
 * memory footprint — events are small JSON strings and the cap below bounds
 * the worst case.
 */
const EVENT_BUFFER_TTL_MS = 60_000;

/** Max events to buffer per conversation before oldest are dropped. */
const EVENT_BUFFER_MAX = 500;

/** Min interval (ms) between `transport.buffer_evicted_oldest` warns per conversation. */
const EVICTION_WARN_THROTTLE_MS = 5_000;

// Fail-fast invariant: buffer TTL must outlive the reconnect grace window,
// otherwise events emitted during a reconnect can be dropped before the
// client has had a chance to come back. See comment on EVENT_BUFFER_TTL_MS.
if (EVENT_BUFFER_TTL_MS < RECONNECT_GRACE_MS) {
  throw new Error(
    `EVENT_BUFFER_TTL_MS (${EVENT_BUFFER_TTL_MS}) must be >= RECONNECT_GRACE_MS (${RECONNECT_GRACE_MS})`
  );
}

interface BufferedEvent {
  data: string;
  timestamp: number;
}

export class SSETransport {
  /**
   * Open subscribers per stream id — a SET, not a slot.
   *
   * A slot made every client fight for one connection. `DASHBOARD_STREAM` is
   * shared by every console window, so two tabs evicted each other in a loop:
   * A registers and the server closes B, B's EventSource reconnects and closes
   * A, forever. Whatever was emitted in the gap reached at most one of them and
   * the rest never learned of it — the rail's counts froze at whatever they
   * were when the tab first painted. The same shape applied to two tabs on one
   * chat, it was just quieter.
   *
   * A stale writer is retired when it aborts, when a write to it fails, or by
   * the zombie reaper — not by whoever connects next.
   */
  private streams = new Map<string, Set<SSEWriter>>();
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private zombieReaperHandle: ReturnType<typeof setInterval> | null = null;
  private eventBuffer = new Map<string, BufferedEvent[]>();
  private bufferCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastEvictionWarnAt = new Map<string, number>();

  constructor(
    private onCleanup?: (conversationId: string) => void,
    private graceMs: number = RECONNECT_GRACE_MS
  ) {}

  /**
   * Subscribe an SSE stream to a conversation (or to the dashboard feed).
   * Every existing subscriber keeps its connection.
   * Replays any buffered events that arrived while nobody was subscribed.
   */
  registerStream(conversationId: string, stream: SSEWriter): void {
    let subscribers = this.streams.get(conversationId);
    if (subscribers === undefined) {
      subscribers = new Set();
      this.streams.set(conversationId, subscribers);
    }
    subscribers.add(stream);

    // Cancel pending cleanup — client reconnected
    const pendingCleanup = this.cleanupTimers.get(conversationId);
    if (pendingCleanup) {
      clearTimeout(pendingCleanup);
      this.cleanupTimers.delete(conversationId);
    }

    // Replay buffered events to the joining stream. The buffer only fills while
    // the id has no OPEN subscriber, so there is no one else these are owed to.
    const buffered = this.eventBuffer.get(conversationId);
    if (buffered && buffered.length > 0) {
      const now = Date.now();
      const valid = buffered.filter(e => now - e.timestamp < EVENT_BUFFER_TTL_MS);
      const expired = buffered.length - valid.length;
      this.clearBuffer(conversationId);
      if (expired > 0) {
        // Events outlived the buffer TTL before the client reconnected.
        // Symptom on the UI: stuck tool cards for any tool_result that was
        // in the expired batch. If this fires in practice, bump TTL further.
        getLog().warn(
          { conversationId, expired, ttlMs: EVENT_BUFFER_TTL_MS },
          'transport.buffer_ttl_expired'
        );
      }
      if (valid.length > 0) {
        getLog().debug({ conversationId, count: valid.length }, 'sse_buffer_replay');
        for (const event of valid) {
          if (stream.closed) break;
          stream.writeSSE({ data: event.data }).catch((e: unknown) => {
            getLog().warn({ conversationId, err: e }, 'sse_buffer_replay_failed');
          });
        }
      }
    }
  }

  /**
   * Retire ONE subscriber. The writer is required: with several clients on a
   * stream, "remove the stream for this id" is not something a caller can say
   * truthfully, and a late onAbort must only ever retire its own connection —
   * never the one that replaced it (React StrictMode double-mounts make that
   * connect → disconnect → reconnect race ordinary).
   */
  removeStream(conversationId: string, stream: SSEWriter): void {
    this.dropSubscriber(conversationId, stream);
  }

  hasActiveStream(conversationId: string): boolean {
    return this.openSubscribers(conversationId).length > 0;
  }

  start(): void {
    // Reap zombie streams every 5 minutes
    this.zombieReaperHandle = setInterval(() => {
      for (const [id, subscribers] of [...this.streams]) {
        for (const stream of [...subscribers]) {
          if (stream.closed) {
            this.dropSubscriber(id, stream);
          }
        }
      }
    }, 300_000);

    getLog().info('web.adapter_ready');
  }

  stop(): void {
    // Stop zombie stream reaper
    if (this.zombieReaperHandle) {
      clearInterval(this.zombieReaperHandle);
      this.zombieReaperHandle = null;
    }

    for (const [id, subscribers] of this.streams) {
      for (const stream of subscribers) {
        if (!stream.closed) {
          stream.close().catch((e: unknown) => {
            getLog().warn({ conversationId: id, err: e }, 'sse_close_failed');
          });
        }
      }
      getLog().debug({ conversationId: id, subscribers: subscribers.size }, 'sse_stream_closed');
    }
    this.streams.clear();
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
    this.eventBuffer.clear();
    this.lastEvictionWarnAt.clear();
    for (const timer of this.bufferCleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.bufferCleanupTimers.clear();
    getLog().info('web.adapter_stopped');
  }

  async emit(conversationId: string, event: string): Promise<void> {
    const targets = this.openSubscribers(conversationId);
    if (targets.length === 0) {
      this.bufferEvent(conversationId, event);
      return;
    }
    // One slow or broken subscriber must not deny the others the event, so the
    // writes go out together and each failure is contained to its own writer.
    await Promise.all(
      targets.map(async stream => {
        try {
          await stream.writeSSE({ data: event });
        } catch (e: unknown) {
          this.retireOnWriteFailure(conversationId, stream, e);
        }
      })
    );
  }

  /**
   * Emit a workflow event to the SSE stream for a conversation. Fire-and-forget.
   */
  emitWorkflowEvent(conversationId: string, event: string): void {
    this.writeToStream(conversationId, event);
  }

  /**
   * Write an event to every open subscriber, buffering it when there are none.
   * Used by emitWorkflowEvent and any other fire-and-forget path.
   */
  private writeToStream(conversationId: string, event: string): void {
    const targets = this.openSubscribers(conversationId);
    if (targets.length === 0) {
      this.bufferEvent(conversationId, event);
      return;
    }
    for (const stream of targets) {
      stream.writeSSE({ data: event }).catch((e: unknown) => {
        this.retireOnWriteFailure(conversationId, stream, e);
      });
    }
  }

  /** The subscribers an event can actually reach right now. */
  private openSubscribers(conversationId: string): SSEWriter[] {
    const subscribers = this.streams.get(conversationId);
    if (subscribers === undefined) return [];
    return [...subscribers].filter(stream => !stream.closed);
  }

  /**
   * Retire a subscriber whose write failed, and close it so the browser's
   * EventSource sees the disconnect and reconnects — rather than holding a
   * socket that silently drops everything sent to it.
   */
  private retireOnWriteFailure(conversationId: string, stream: SSEWriter, err: unknown): void {
    getLog().warn({ conversationId, err }, 'sse_write_failed');
    this.dropSubscriber(conversationId, stream);
    stream.close().catch((_: unknown) => {
      /* stream already closing */
    });
  }

  /**
   * Remove one subscriber, and schedule cleanup only once the LAST one is gone.
   * Persistence state is shared by every client on the conversation, so one tab
   * closing must not flush it out from under another.
   */
  private dropSubscriber(conversationId: string, stream: SSEWriter): void {
    const subscribers = this.streams.get(conversationId);
    if (subscribers?.delete(stream) !== true) return;
    if (subscribers.size === 0) this.streams.delete(conversationId);
    if (!this.hasActiveStream(conversationId)) {
      // Grace period lets a reconnect cancel this without losing state.
      this.scheduleCleanup(conversationId, this.graceMs);
    }
  }

  /**
   * Buffer an event for later replay when a stream connects.
   * Events expire after EVENT_BUFFER_TTL_MS and are capped at EVENT_BUFFER_MAX per conversation.
   */
  private bufferEvent(conversationId: string, data: string): void {
    let buf = this.eventBuffer.get(conversationId);
    if (!buf) {
      buf = [];
      this.eventBuffer.set(conversationId, buf);
    }
    buf.push({ data, timestamp: Date.now() });
    // Cap buffer size — drop oldest if over limit. Warn so we notice if
    // this ever happens in practice: evicted events mean the UI will miss
    // something when the client reconnects.
    if (buf.length > EVENT_BUFFER_MAX) {
      buf.shift();
      // Throttle: a runaway producer could overflow by hundreds in a tight
      // loop and flood logs. Warn at most once per EVICTION_WARN_THROTTLE_MS
      // per conversation — enough to notice in practice without flooding.
      const lastWarn = this.lastEvictionWarnAt.get(conversationId) ?? 0;
      const now = Date.now();
      if (now - lastWarn >= EVICTION_WARN_THROTTLE_MS) {
        this.lastEvictionWarnAt.set(conversationId, now);
        getLog().warn(
          { conversationId, bufferMax: EVENT_BUFFER_MAX },
          'transport.buffer_evicted_oldest'
        );
      }
    }
    // Schedule auto-cleanup so buffers don't leak for conversations that never
    // connect. Reset the timer on each new event so the buffer is held for
    // TTL past the *most recent* event, not the first one.
    const existingCleanup = this.bufferCleanupTimers.get(conversationId);
    if (existingCleanup) clearTimeout(existingCleanup);
    const timer = setTimeout(() => {
      this.clearBuffer(conversationId);
    }, EVENT_BUFFER_TTL_MS + 500);
    this.bufferCleanupTimers.set(conversationId, timer);
    getLog().debug({ conversationId, buffered: buf.length }, 'sse_event_buffered');
  }

  private clearBuffer(conversationId: string): void {
    this.eventBuffer.delete(conversationId);
    this.lastEvictionWarnAt.delete(conversationId);
    const timer = this.bufferCleanupTimers.get(conversationId);
    if (timer) {
      clearTimeout(timer);
      this.bufferCleanupTimers.delete(conversationId);
    }
  }

  /**
   * Schedule onCleanup callback after a delay.
   * If the client reconnects before the timer fires, the cleanup is cancelled.
   */
  private scheduleCleanup(conversationId: string, delayMs: number): void {
    // Cancel any existing timer for this conversation
    const existing = this.cleanupTimers.get(conversationId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      try {
        this.cleanupTimers.delete(conversationId);
        // Only clean up if nobody is listening (no client reconnected). Asks
        // for an OPEN subscriber, not a registered one — a writer that closed
        // without aborting is not an audience, and waiting for the reaper to
        // say so would hold the flush for up to five minutes.
        if (!this.hasActiveStream(conversationId)) {
          if (this.onCleanup) {
            this.onCleanup(conversationId);
          }
        }
      } catch (e: unknown) {
        getLog().warn({ conversationId, err: e }, 'cleanup_timer_failed');
      }
    }, delayMs);

    this.cleanupTimers.set(conversationId, timer);
  }
}
