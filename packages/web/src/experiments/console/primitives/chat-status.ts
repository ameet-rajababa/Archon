/**
 * What a chat is, in six states.
 *
 *   working   the server is executing a turn for it right now
 *   awaiting  it is your move — a run it started is paused on a gate, or the
 *             agent asked a question and has not been answered
 *   unread    it has moved since you last read it to the end
 *   ready     the agent says the work is finished; nobody has filed it yet
 *   done      a human said this chat's unit of work has landed
 *   idle      none of those
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
 * "Done" is the odd one and is meant to be. The others are claims about this
 * instant, which the server can observe; done is a claim about the WORK,
 * which it cannot. A chat is one unit of work — an issue, or a cluster of
 * them — and whether that work has landed is a judgement. Nothing the server
 * can see distinguishes "the issue is closed" from "no run happens to be
 * executing", and that second thing is exactly what idle already says. So it
 * is recorded, by a person, on the row.
 *
 * `ready` is the same claim made by the other party. The agent finishes, says
 * so, and asks; the human decides. Before this state those two moments were
 * one — the only way to show a finished chat was to mark it done, which is the
 * human's call to make, so the agent either took that decision or said nothing
 * and the row stayed `idle`. Idle and finished looked identical, which is the
 * same always-on/never-on failure the header describes twice above, in its
 * other direction: a state nothing could distinguish.
 *
 * Its signal is the row's own colour set to green, which the agent can write
 * and a person can see and clear. That overloads `color`, and the trade is
 * deliberate: a dedicated column would be a migration for a claim that is
 * already exactly what colouring a row green means here. `ready` is suppressed
 * once `completed` is set, so the two never compete.
 *
 * A chat whose last word was merely the agent's is NOT awaiting, and the rule
 * that said so existed twice and failed the same way both times: every
 * finished chat ends with the agent, so the rail went amber end to end and
 * idle became a state nothing ever reached. A mark that is always on is not a
 * signal.
 *
 * `unread` is that idea built the way it had to be built. What was missing
 * both previous times was a way to turn the mark OFF — so it is a stored read
 * marker (`last_read_at`), written when a human actually reaches the bottom of
 * the stream, and unread is the COMPARISON against activity rather than a
 * property of the last message. Reading a chat clears it; idle stays reachable.
 *
 * It shares amber with `awaiting` because both ask the same thing of someone
 * scanning the rail. It ranks below `working` because a chat mid-sentence is
 * unfinished rather than unread.
 */
import { splitReply } from './ask';
import { runMessageConversationId } from './run';

export type ChatStatus = 'working' | 'awaiting' | 'unread' | 'ready' | 'done' | 'idle';

export interface ChatStatusSets {
  /** Platform conversation ids the server is executing a turn for. */
  working: ReadonlySet<string>;
  /**
   * Chats asking for something specific: a run paused on an approval, or an
   * unanswered question. Outranks working, because a run that has stopped to
   * ask is not running.
   */
  awaiting: ReadonlySet<string>;
  /**
   * Chats a human has marked finished. Ranked BELOW both live states: green
   * is a claim about the work, and what a chat is doing right now outranks
   * it, so a finished chat that starts moving again says so and returns to
   * green when it stops.
   */
  done: ReadonlySet<string>;
  /**
   * Chats that have moved since the reader last reached the bottom of them.
   *
   * Ranked BELOW working, deliberately: a chat mid-sentence is unfinished, not
   * unread, and marking it while it streams would put the whole rail amber for
   * the duration of every turn.
   */
  unread: ReadonlySet<string>;
  /**
   * Chats the agent has flagged finished and nobody has filed yet.
   *
   * Ranked directly above `done` and below `unread`, for `done`'s own reason:
   * a finished chat that has since spoken is worth looking at again. A chat
   * that is already `done` is never here — `readyIds` excludes it — so the
   * order between the two is a formality rather than a contest.
   */
  ready: ReadonlySet<string>;
}

/**
 * Exclusive and ordered: awaiting, working, unread, ready, done, idle.
 *
 * The two live states come first because they are about right now, and right
 * now outranks a claim about the work as a whole. Unread sits under both: a
 * chat still streaming has not been missed yet, it is simply not finished, and
 * amber on every turn in flight would be noise. Done sits above idle because
 * "this landed" is strictly more than "nothing is pending", and under unread
 * because a finished chat that has since spoken is worth looking at again.
 *
 * There was once another set — chats whose last word was the agent's — ranked
 * below working so a streaming chat would not go amber mid-sentence. The
 * ranking was right and the STATE was wrong: every finished chat ends with the
 * agent, so every finished chat was amber, and idle became unreachable. It
 * also needed a `liveKnown` flag to be safe, because `working` is polled and an
 * unanswered poll would have read as a finished turn — machinery whose only
 * job was to stop a signal lying, which is a signal worth deleting instead.
 *
 * Every state that is left says something a person can act on, or something a
 * person has already said.
 */
export function chatStatus(conversationId: string, sets: ChatStatusSets): ChatStatus {
  if (sets.awaiting.has(conversationId)) return 'awaiting';
  if (sets.working.has(conversationId)) return 'working';
  if (sets.unread.has(conversationId)) return 'unread';
  if (sets.ready.has(conversationId)) return 'ready';
  if (sets.done.has(conversationId)) return 'done';
  return 'idle';
}

/** Chats a human has marked finished, as the set `chatStatus` reads. */
export function completedIds(
  conversations: readonly { id: string; completed: boolean }[]
): Set<string> {
  const out = new Set<string>();
  for (const c of conversations) if (c.completed) out.add(c.id);
  return out;
}

/**
 * Chats the agent has flagged finished, by colouring the row green, and that
 * nobody has filed yet.
 *
 * `completed` wins: once a person has filed the chat the flag has served its
 * purpose, and leaving both on would make the rail argue with itself about
 * which green it meant.
 */
export function readyIds(
  conversations: readonly { id: string; color: string | null; completed: boolean }[]
): Set<string> {
  const out = new Set<string>();
  for (const c of conversations) if (c.color === 'green' && !c.completed) out.add(c.id);
  return out;
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
 * Chats that have moved since the reader last reached the bottom of them.
 *
 * This is the rule that failed twice as "the newest message is the agent's".
 * It failed because it could only ever turn ON: every finished chat ends with
 * the agent, so the rail went amber end to end and `idle` became unreachable.
 * The read marker is the whole difference — `lastReadAt` is written when a
 * human scrolls to the bottom, so the mark clears and the state is reachable
 * in both directions.
 *
 * Both timestamps are compared as instants rather than strings. They are ISO-8601
 * from the same server, so lexical order would usually agree — but "usually"
 * is not a property worth resting a signal on, and a differing offset or
 * fractional precision breaks it silently rather than loudly.
 *
 * An unparseable or absent `lastActivityAt` is NOT unread: the chat has no
 * activity to be behind on. An absent `lastReadAt` with real activity IS
 * unread, which is what a chat nobody has opened should say.
 */
export function unreadIds(
  conversations: readonly { id: string; lastActivityAt: string | null; lastReadAt: string | null }[]
): Set<string> {
  const out = new Set<string>();
  for (const c of conversations) {
    const activity = instant(c.lastActivityAt);
    if (activity === null) continue;
    const read = instant(c.lastReadAt);
    if (read === null || activity > read) out.add(c.id);
  }
  return out;
}

/** An ISO timestamp as a comparable number, or null when there is nothing to compare. */
function instant(raw: string | null): number | null {
  if (raw === null || raw === '') return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
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
 * presentational choice belongs. Two label maps for one set of states would be
 * two vocabularies again, which is the thing this file exists to prevent.
 */
export const STATUS_LABEL: Readonly<Record<ChatStatus, string>> = {
  working: 'Working',
  awaiting: 'Needs you',
  unread: 'Unread',
  ready: 'Ready to close',
  done: 'Done',
  idle: 'Idle',
};

/**
 * The token that renders each state. Amber is "your move", red stays failure.
 *
 * `unread` deliberately shares `awaiting`'s amber. The two are different facts
 * — one is a question you have not answered, the other is a message you have
 * not seen — but they ask for the same thing from a reader scanning the rail,
 * and a second shade of amber would have to be decoded rather than scanned.
 * The distinction stays available in the label and the tooltip.
 */
export const STATUS_COLOR: Readonly<Record<ChatStatus, string>> = {
  working: 'var(--running)',
  awaiting: 'var(--warning)',
  unread: 'var(--warning)',
  ready: 'var(--ready)',
  done: 'var(--success)',
  idle: 'var(--text-tertiary)',
};

export const STATUS_TITLE: Readonly<Record<ChatStatus, string>> = {
  working: 'The agent is working on this chat right now',
  awaiting: 'This chat is waiting for your answer',
  unread: 'This chat has replied since you last read it',
  ready: 'The work here is finished — mark it done when you are ready',
  done: "This chat's work is finished",
  idle: 'Nothing is running in this chat',
};
