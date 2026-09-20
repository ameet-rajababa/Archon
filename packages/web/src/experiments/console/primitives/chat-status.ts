/**
 * What a chat is doing, in three states.
 *
 *   working   the server is executing a turn for it right now
 *   awaiting  a run it started is paused on an approval — it is your move
 *   idle      neither
 *
 * Exclusive and ordered: a chat that is both working and awaiting is awaiting,
 * because the half that needs a human outranks the half that does not.
 *
 * The two signals are different in kind and that is deliberate. "Working" is
 * the server's own answer — the conversation lock, read from /api/health — so
 * it is true even for a turn this browser did not start. "Awaiting" is derived
 * from the runs feed, because an approval belongs to a RUN and the run knows
 * which conversation dispatched it.
 */
export type ChatStatus = 'working' | 'awaiting' | 'idle';

export interface ChatStatusSets {
  /** Platform conversation ids the server is executing a turn for. */
  working: ReadonlySet<string>;
  /** Platform conversation ids with a run paused on an approval. */
  awaiting: ReadonlySet<string>;
}

export function chatStatus(conversationId: string, sets: ChatStatusSets): ChatStatus {
  if (sets.awaiting.has(conversationId)) return 'awaiting';
  if (sets.working.has(conversationId)) return 'working';
  return 'idle';
}

/**
 * Chats with a run paused on an approval.
 *
 * `status === 'paused'` alone is not enough: a run can be paused without
 * anything being asked of you, and marking those chats as needing you would
 * make the mark mean "something is not finished" — which is what `idle`
 * already means.
 */
export function awaitingInputIds(
  runs: readonly { status: string; approval?: unknown; conversationPlatformId?: string | null }[]
): Set<string> {
  const out = new Set<string>();
  for (const r of runs) {
    if (r.status !== 'paused') continue;
    if (r.approval === null || r.approval === undefined) continue;
    const id = r.conversationPlatformId;
    if (typeof id === 'string' && id !== '') out.add(id);
  }
  return out;
}

export const STATUS_LABEL: Readonly<Record<ChatStatus, string>> = {
  working: 'working',
  awaiting: 'needs you',
  idle: '',
};

export const STATUS_TITLE: Readonly<Record<ChatStatus, string>> = {
  working: 'The agent is working on this chat right now',
  awaiting: 'This chat is waiting for your answer',
  idle: 'Nothing is running in this chat',
};
