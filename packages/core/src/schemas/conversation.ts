/**
 * Zod schemas for conversation row types.
 */
import { z } from '@hono/zod-openapi';
import { identityPlatformSchema } from './user';

// Re-export so consumers don't need to import from user.ts directly
export { identityPlatformSchema };
export type { IdentityPlatform } from './user';

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

/**
 * The colors a conversation may be labelled with. Names, not hex values, so the
 * UI owns the rendering and a theme change never has to rewrite stored rows.
 *
 * `null` means no color, which is every conversation's default. The server
 * never interprets a color; it is a visual label for scanning a chat list.
 */
export const CONVERSATION_COLORS = ['magenta', 'violet', 'blue', 'green', 'amber', 'red'] as const;

export const conversationColorSchema = z.enum(CONVERSATION_COLORS);
export type ConversationColor = z.infer<typeof conversationColorSchema>;

export const conversationRowSchema = z.object({
  id: z.string(),
  platform_type: z.string(),
  platform_conversation_id: z.string(),
  codebase_id: z.string().nullable(),
  cwd: z.string().nullable(),
  isolation_env_id: z.string().nullable(),
  ai_assistant_type: z.string(),
  title: z.string().nullable(),
  color: z.string().nullable(),
  hidden: z.boolean(),
  /**
   * Hand-arranged position in the chat rail, ascending. NULL means never
   * arranged, and reads as "newest first" — the client puts those above every
   * placed chat, because a brand-new chat at the bottom of a long rail cannot
   * be found.
   *
   * Ties are possible and harmless: the rail only ever renumbers the chats it
   * is showing, so an archived chat can hold the same value as an active one.
   * Whoever reads the column breaks a tie by recency.
   */
  sort_order: z.number().nullable(),
  /**
   * A human named this chat, so automatic re-titling leaves it alone.
   *
   * Nullable because every row predates the column and an older binary never
   * writes it — absent and false are the same statement. Pinned means "a person
   * chose this", not "frozen": an explicit request to re-title still overrides
   * it. The rule is that automation respects the edit and a direct instruction
   * does not have to.
   */
  title_pinned: z.boolean().nullable(),
  deleted_at: z.date().nullable(),
  last_activity_at: z.date().nullable(),
  user_id: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

export type Conversation = z.infer<typeof conversationRowSchema>;
