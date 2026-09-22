/**
 * Zod schemas for message row types.
 */
import { z } from '@hono/zod-openapi';

// ---------------------------------------------------------------------------
// MessageRow
// ---------------------------------------------------------------------------

export const messageRowSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  // `system` is a notice the conversation produced about itself — why it handed
  // off, why it declined to. Not the agent speaking, so not `assistant`; not a
  // person, so not `user`. The column has always been a VARCHAR with no check
  // constraint, so older rows are unaffected and older readers see a role they
  // will render as plain text rather than reject.
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  metadata: z.string(),
  user_id: z.string().nullable(),
  created_at: z.string(),
});

export type MessageRow = z.infer<typeof messageRowSchema>;
