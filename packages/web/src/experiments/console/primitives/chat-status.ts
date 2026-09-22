/**
 * What a chat is doing, in three states.
 *
 *   working   the server is executing a turn for it right now
 *   awaiting  it is your move — a run it started is paused on a gate, or the
 *             agent asked a question and has not been answered
 *   idle      neither
 *
 * Exclusive and ordered: a chat that is both working and awaiting is awaiting,
 * because the half that needs a human outranks the half that does not.
 *
 * The signals are different in kind and that is deliberate. "Working" is the
 * server's own answer — the conversation lock, read from /api/health — so it
 * is true even for a turn this browser did not start. "Awaiting" means a chat
 * has asked for something SPECIFIC: a run paused on a gate, or an unanswered
 * ask block. Both are things a human can act on and then be done with.
 *
 * A chat whose last word was merely the agent's is NOT awaiting. That rule
 * existed twice and failed the same way both times: every finished chat ends
 * with the agent, so the rail went amber end to end and idle became a state
 * nothing ever reached. A mark that is always on is not a signal.
 *
 * That leaves idle meaning what it should — "nothing is pending here" — and
 * reachable, which is the point.
 */
import { splitReply } from './ask';
import { runMessageConversationId } from './run';

export type ChatStatus = 'working' | 'awaiting' | 'idle';

export interface ChatStatusSets {
  /** Platform conversation ids the server is executing a turn for. */
  working: ReadonlySet<string>;
  /**
   * Chats asking for something specific: a run paused on an approval, or an
   * unanswered question. Outranks working, because a run that has stopped to
   * ask is not running.
   */
  awaiting: ReadonlySet<string>;
}

/**
 * Exclusive and ordered, and the order ends at two.
 *
 * There was a third set — chats whose last word was the agent's — ranked below
 * working so a streaming chat would not go amber mid-sentence. The ranking was
 * right and the STATE was wrong: every finished chat ends with the agent, so
 * every finished chat was amber, and idle became unreachable. It also needed a
 * `liveKnown` flag to be safe, because `working` is polled and an unanswered
 * poll would have read as a finished turn — machinery whose only job was to
 * stop a signal lying, which is a signal worth deleting instead.
 *
 * What is left says something a person can act on and then be finished with.
 */
export function chatStatus(conversationId: string, sets: ChatStatusSets): ChatStatus {
  if (sets.awaiting.has(conversationId)) return 'awaiting';
  if (sets.working.has(conversationId)) return 'working';
  return 'idle';
}

/**
 * Chats whose newest message is an unanswered question.
 *
 * An ask block is the agent asking you something in a form you can click, and
 * a chat sitting on one is waiting for a human exactly as a paused gate is.
 * The two arrive by different routes — a gate belongs to a RUN, a question is
 * a MESSAGE — but they mean the same thing to a reader scanning the rail.
 *
 * "Unanswered" needs no state of its own: answering an ask block is sending a
 * message, so a reply makes the newest message the human's and the question
 * stops being the last word. That is also why this reads the LAST message
 * only, and why nothing has to be marked as resolved.
 *
 * `splitReply` is the authority on what an ask block is, deliberately: the
 * server's test for what to send is broader on purpose (see `ask_candidate`),
 * so the decision has to be made here, with the parser that renders the card.
 */
export function askAwaitingIds(
  conversations: readonly { id: string; askCandidate: string | null }[]
): Set<string> {
  const out = new Set<string>();
  for (const c of conversations) {
    if (c.askCandidate === null || c.askCandidate === '') continue;
    if (splitReply(c.askCandidate).some(part => part.kind === 'ask')) out.add(c.id);
  }
  return out;
}

/**
 * Chats with a run paused on an approval.
 *
 * `status === 'paused'` alone is not enough: a run can be paused without
 * anything being asked of you, and marking those chats as needing you would
 * make the mark mean "something is not finished" — which is what `idle`
 * already means.
 *
 * Which conversation a run belongs to is `runMessageConversationId`'s to
 * decide, and asking it is not optional here. This read `conversationPlatformId`
 * alone, which the runs FEED never carries — the dashboard query exposes a
 * chat-dispatched run's conversation as `worker_platform_id` (#2048). So the
 * set came back empty for exactly the runs it exists to find, and no chat has
 * ever gone amber.
 */
export function awaitingInputIds(
  runs: readonly {
    status: string;
    approval?: unknown;
    conversationPlatformId?: string | null;
    workerPlatformId?: string | null;
  }[]
): Set<string> {
  const out = new Set<string>();
  for (const r of runs) {
    if (r.status !== 'paused') continue;
    if (r.approval === null || r.approval === undefined) continue;
    const id = runMessageConversationId(r);
    if (id !== null && id !== '') out.add(id);
  }
  return out;
}

/**
 * The word for each state — the one place it is spelled.
 *
 * Sentence case because the project chip renders it as a label in a header;
 * the rail's stamp lower-cases it in CSS, which is where a purely
 * presentational choice belongs. Two label maps for three states would be two
 * vocabularies again, which is the thing this file exists to prevent.
 */
export const STATUS_LABEL: Readonly<Record<ChatStatus, string>> = {
  working: 'Working',
  awaiting: 'Needs you',
  idle: 'Idle',
};

/** The token that renders each state. Amber is "your move", red stays failure. */
export const STATUS_COLOR: Readonly<Record<ChatStatus, string>> = {
  working: 'var(--running)',
  awaiting: 'var(--warning)',
  idle: 'var(--text-tertiary)',
};

export const STATUS_TITLE: Readonly<Record<ChatStatus, string>> = {
  working: 'The agent is working on this chat right now',
  awaiting: 'This chat is waiting for your answer',
  idle: 'Nothing is running in this chat',
};
