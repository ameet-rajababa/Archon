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
  /**
   * When a human said this chat's unit of work was finished.
   *
   * A chat is one issue or one cluster of them, and "finished" is a judgement
   * only a person can make — nothing the server can observe distinguishes
   * "the work landed" from "nothing is running at this instant", which is
   * what an absent run already says.
   *
   * Independent of `deleted_at`, because the two answer different questions:
   * done says the work landed, archived says stop showing it. A finished
   * chat you still want in the rail is the normal case.
   */
  completed_at: z.date().nullable(),
  /**
   * When a human last read this chat to the end.
   *
   * Paired with `last_activity_at`, and only meaningful beside it: unread is
   * `last_activity_at > last_read_at`. NULL means never read, which is the
   * answer for a chat nobody has opened and for every row that predates the
   * column — one meaning, not two.
   *
   * It exists because the cheap version of the signal does not work. "The
   * newest message is the agent's" was built and removed twice, since every
   * finished chat ends with the agent, so the whole rail went amber and `idle`
   * became unreachable. A mark that is always on is not a signal. Reading is
   * what turns this one off.
   *
   * Rows that predate the column were backfilled from `last_activity_at` once,
   * in the boot that added it: they were read, there was simply nowhere to
   * record it, and leaving them NULL would have delivered that same all-amber
   * rail on the first boot after the upgrade.
   */
  last_read_at: z.date().nullable(),
  deleted_at: z.date().nullable(),
  last_activity_at: z.date().nullable(),
  user_id: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

export type Conversation = z.infer<typeof conversationRowSchema>;
