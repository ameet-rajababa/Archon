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
 * is true even for a turn this browser did not start. "Awaiting" arrives three
 * ways, all meaning the same thing to a reader: a run paused on a gate, an
 * unanswered question, and a chat whose last word was the agent's. Only the
 * ordering separates them — see ChatStatusSets.
 *
 * That leaves idle meaning what it should. Not "finished", but "nothing is
 * pending here": an empty chat, or one where you spoke last and nothing picked
 * it up.
 */
import { splitReply } from './ask';
import { runMessageConversationId } from './run';

export type ChatStatus = 'working' | 'awaiting' | 'idle';

export interface ChatStatusSets {
  /** Platform conversation ids the server is executing a turn for. */
  working: ReadonlySet<string>;
  /**
   * Chats whose last word was the agent's — your move, once the turn is over.
   *
   * Ranked BELOW working, and that ordering is why it is a third set rather
   * than more ids in `awaiting`: mid-turn the agent's own streamed text IS the
   * last message, so merging them would paint every running chat amber the
   * moment it said anything.
   *
   * Ordering alone is not enough, and this is where it was got wrong before.
   * `working` is a POLLED answer, so before the first poll lands it is empty —
   * not because nothing is running, but because nobody has asked. Fall through
   * on that and a chat being actively worked on announces that it needs a
   * human, which is the one direction this signal must never fail in. Pass
   * this set only once the working answer is KNOWN; omit it until then.
   */
  awaitingReply?: ReadonlySet<string>;
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
 * working so that a streaming chat would not go amber mid-sentence. The
 * ranking was right and the state was wrong: EVERY finished chat ends with the
 * agent, so five of five went amber and the colour stopped meaning anything.
 * Worse, `working` is a polled signal, so in the seconds after a reconnect the
 * mask was simply missing and a chat being actively worked on announced that
 * it needed a human.
 *
 * An unknown answer now falls to `idle`. A signal that degrades to silence
 * costs a moment of under-reporting; one that degrades to a call for help
 * teaches the reader to ignore the only colour that was supposed to move them.
 */
export function chatStatus(conversationId: string, sets: ChatStatusSets): ChatStatus {
  if (sets.awaiting.has(conversationId)) return 'awaiting';
  if (sets.working.has(conversationId)) return 'working';
  if (sets.awaitingReply?.has(conversationId) === true) return 'awaiting';
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
/**
 * Chats whose last word was the agent's.
 *
 * Every one of them is waiting on a human: a reply that has been read is
 * indistinguishable from one nobody has seen, so only the person can settle
 * it. A chat you spoke in last is deliberately not here — there the ball is
 * with the machine, or the turn was dropped, and neither is something to
 * prompt you about.
 *
 * Only meaningful once the working answer is known. See `awaitingReply`.
 */
export function awaitingReplyIds(
  conversations: readonly { id: string; lastMessageRole: string | null }[]
): Set<string> {
  const out = new Set<string>();
  for (const c of conversations) {
    if (c.lastMessageRole === 'assistant') out.add(c.id);
  }
  return out;
}

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
