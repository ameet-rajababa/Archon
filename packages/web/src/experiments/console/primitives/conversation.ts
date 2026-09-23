/** Conversation summary primitive. Normalized from the server conversation row. */
export interface ConversationSummary {
  /**
   * Platform conversation id (`web-<ts>-<rand>`) — NOT the DB uuid. This is the
   * id the `/api/conversations/:id/messages` and `/api/stream/:id` routes accept.
   */
  id: string;
  /**
   * Conversation DB uuid. This is what a run's `parent_conversation_id` points
   * at, so it — not `id` — is the key for "runs launched from this chat".
   */
  dbId: string;
  title: string | null;
  platformType: string;
  lastActivityAt: string | null;
}

interface RawConversation {
  id: string;
  platform_conversation_id: string;
  platform_type: string;
  title: string | null;
  last_activity_at: string | null;
}

export function toConversationSummary(raw: RawConversation): ConversationSummary {
  return {
    id: raw.platform_conversation_id,
    dbId: raw.id,
    title: raw.title,
    platformType: raw.platform_type,
    lastActivityAt: raw.last_activity_at,
  };
}

/**
 * The DB uuid behind a platform conversation id. A run's
 * `parent_conversation_id` points at the uuid, while the routes that carry a
 * chat around the console carry the platform id, so every "runs launched from
 * this chat" lookup has to cross this one join. Returns `null` when no chat is
 * open, or for the moment between creating one and the list refetching.
 */
export function resolveConversationDbId(
  conversations: ConversationSummary[],
  platformConversationId: string | null
): string | null {
  if (platformConversationId === null) return null;
  return conversations.find(c => c.id === platformConversationId)?.dbId ?? null;
}
