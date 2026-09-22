/** Conversation summary primitive. Normalized from the server conversation row. */
/**
 * The colors a chat can be labeled with, paired with the design token that
 * renders each. Copied from `@archon/core`'s CONVERSATION_COLORS rather than
 * imported — the console may not import production modules (ESLint isolation
 * rule) — so the two lists must change together.
 *
 * Names, not hex: the server stores the name and the UI owns the rendering, so
 * re-theming never has to rewrite stored rows.
 */
export const CONVERSATION_COLORS = [
  { value: 'magenta', label: 'Magenta', token: 'var(--brand-magenta)' },
  { value: 'violet', label: 'Violet', token: 'var(--brand-violet)' },
  { value: 'blue', label: 'Blue', token: 'var(--brand-blue)' },
  { value: 'green', label: 'Green', token: 'var(--brand-green)' },
  { value: 'amber', label: 'Amber', token: 'var(--warning)' },
  { value: 'red', label: 'Red', token: 'var(--error)' },
] as const;

export type ConversationColor = (typeof CONVERSATION_COLORS)[number]['value'];

export interface ConversationSummary {
  /**
   * Platform conversation id (`web-<ts>-<rand>`) — NOT the DB uuid. This is the
   * id the `/api/conversations/:id/messages` and `/api/stream/:id` routes accept.
   */
  id: string;
  /** Database id. Workflow runs reference this, not the platform id. */
  dbId: string;
  title: string | null;
  platformType: string;
  lastActivityAt: string | null;
  /** User-chosen color label, or null for none. */
  color: ConversationColor | null;
  /**
   * Which assistant answers this chat — `claude`, `codex`, `pi`, a community
   * provider id. Set when the chat is created and stored on the row, so it is
   * real provenance rather than a guess from the current default.
   */
  assistant: string;
  /** Archived chats are hidden from the default list but are never destroyed. */
  archived: boolean;
  /**
   * This chat's newest message, when the server thinks it might hold an ask
   * block — its test is deliberately broad, so this still has to be parsed
   * before it means anything. Null when there is nothing worth looking at.
   */
  askCandidate: string | null;
  /**
   * Hand-arranged position in the rail, ascending, or `null` for a chat that
   * has never been placed. Stored on the row, so the arrangement follows the
   * reader to any browser rather than living in one machine's localStorage.
   */
  sortOrder: number | null;
  /** Short summary of the chat, or null when nothing has written one yet. */
  /** When the summary was last written — what makes staleness visible. */
  /** True when a human wrote it, so the agent leaves it alone. */
}

interface RawConversation {
  id: string;
  platform_conversation_id: string;
  platform_type: string;
  title: string | null;
  last_activity_at: string | null;
  color: string | null;
  ai_assistant_type: string;
  deleted_at?: string | null;
  sort_order?: number | null;
  ask_candidate?: string | null;
}

/**
 * The wire shape as the console needs it. Everything the server sends that the
 * rail does not read is dropped here rather than carried.
 */
export function toConversationSummary(raw: RawConversation): ConversationSummary {
  return {
    id: raw.platform_conversation_id,
    dbId: raw.id,
    title: raw.title,
    platformType: raw.platform_type,
    lastActivityAt: raw.last_activity_at,
    color: parseConversationColor(raw.color),
    assistant: raw.ai_assistant_type,
    // Archiving is a soft delete, so the timestamp's presence is the state.
    archived: raw.deleted_at != null,
    askCandidate: raw.ask_candidate ?? null,
    // `?? null` covers a server that predates the column, which reads as
    // never arranged rather than as position zero.
    sortOrder: raw.sort_order ?? null,
  };
}

/**
 * Normalise a stored color. Anything unrecognised — written by a newer build,
 * or hand-edited — reads as no color rather than rendering a blank swatch.
 */
export function parseConversationColor(raw: string | null | undefined): ConversationColor | null {
  return CONVERSATION_COLORS.some(c => c.value === raw) ? (raw as ConversationColor) : null;
}

/** The design token that renders a color, or null when the chat has none. */
export function colorToken(color: ConversationColor | null): string | null {
  return CONVERSATION_COLORS.find(c => c.value === color)?.token ?? null;
}

/** Fallback shown before the server's auto-title lands on a fresh chat. */
export const UNTITLED_CHAT = 'Untitled chat';

/**
 * What to show in the switcher. A conversation has no title until the server
 * generates one from the first message, so a brand-new chat would otherwise
 * render as a blank row.
 */
export function conversationLabel(c: ConversationSummary): string {
  const title = c.title?.trim() ?? '';
  return title.length > 0 ? title : UNTITLED_CHAT;
}

/**
 * Most recently active first, so the switcher opens on what the user was last
 * doing. Conversations that have never been active sort last rather than
 * jumping to the top on an unparsable date.
 */
export function byMostRecent(a: ConversationSummary, b: ConversationSummary): number {
  const at = a.lastActivityAt ?? '';
  const bt = b.lastActivityAt ?? '';
  if (at === bt) return 0;
  if (at === '') return 1;
  if (bt === '') return -1;
  return at < bt ? 1 : -1;
}

/**
 * The rail's order: where the user put it, and recency only where they have
 * not said.
 *
 * A chat with no position yet leads. That is the opposite of the project
 * rail's rule and deliberate — a project you just added can wait at the bottom
 * of a short rail, a chat you just started cannot. Those chats stay in recency
 * order among themselves, so the newest is first.
 *
 * Two chats can legitimately hold the same position: the rail renumbers only
 * the chats it is showing, one archive scope at a time, so an archived chat
 * may share a value with an active one. They meet only under "All", and
 * recency breaks the tie so the list never wobbles between two answers.
 */
export function byArrangement(a: ConversationSummary, b: ConversationSummary): number {
  const ao = a.sortOrder;
  const bo = b.sortOrder;
  if (ao === null || bo === null) {
    if (ao === bo) return byMostRecent(a, b);
    return ao === null ? -1 : 1;
  }
  return ao === bo ? byMostRecent(a, b) : ao - bo;
}

/**
 * Two-letter monogram for a chat's tile, mirroring the project rail's rows.
 *
 * Initials of the first two words when there are two, otherwise the first two
 * letters. Falls back to `??` rather than rendering an empty tile, which reads
 * as a loading state that never resolves.
 */
export function conversationMonogram(c: ConversationSummary): string {
  const label = conversationLabel(c);
  const words = label.split(/\s+/).filter(w => /[a-z0-9]/i.test(w));
  if (words.length >= 2) {
    const a = words[0]?.[0] ?? '';
    const b = words[1]?.[0] ?? '';
    const pair = `${a}${b}`.toUpperCase();
    if (pair.length === 2) return pair;
  }
  const letters = label.replace(/[^a-z0-9]/gi, '');
  return letters.length > 0 ? letters.slice(0, 2).toUpperCase() : '??';
}

/**
 * Case-insensitive substring match on the title, for the rail's filter box.
 * An empty query matches everything, so clearing the box restores the list
 * rather than emptying it.
 */
export function matchesFilter(c: ConversationSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  return conversationLabel(c).toLowerCase().includes(q);
}
