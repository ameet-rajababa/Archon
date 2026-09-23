/**
 * Zod schemas for conversation and message API endpoints.
 */
import { z } from '@hono/zod-openapi';
import { conversationColorSchema, conversationRowSchema } from '@archon/core/schemas/conversation';
import { messageRowSchema } from '@archon/core/schemas/message';

/** A conversation record (wire shape with ISO string dates). */
export const conversationSchema = conversationRowSchema
  .extend({
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    deleted_at: z.string().datetime().nullable(),
    completed_at: z.string().datetime().nullable(),
    last_activity_at: z.string().datetime().nullable(),
  })
  .openapi('Conversation');

/** GET /api/conversations query params. */
export const listConversationsQuerySchema = z.object({
  // How many rows to return. A caller that only wants the counts — the project
  // rail draws a number, not a list — asks for few rows and reads `counts`,
  // rather than paying for a page it will throw away. Omitted takes the
  // route's own default.
  limit: z.coerce.number().int().positive().optional(),
  platform: z.string().optional(),
  codebaseId: z.string().optional(),
  // Non-enforcing "mine" filter: 'true' restricts to the caller's own
  // conversations when an identity resolves. Default lists everything. Enum
  // makes the boolean contract explicit (the handler treats only 'true' as on).
  mine: z.enum(['true', 'false']).optional(),
  // Which archived state to list. Omitted behaves exactly as before, so every
  // existing caller keeps seeing active conversations only.
  archived: z.enum(['active', 'archived', 'all']).optional(),
  // Where in its lifecycle a chat is: `open` has no completion recorded,
  // `done` has one. Omitted does not ask, so an existing caller keeps every
  // row it already got. Separate from `archived` because it is a separate
  // question on a separate column — removed versus finished.
  state: z.enum(['open', 'done', 'all']).optional(),
});

/**
 * GET /api/conversations response.
 *
 * An envelope rather than a bare array because the listing is capped: the
 * counts alongside answer for every row the filters match, so a client can
 * tell a complete list from a truncated one. Finished chats accumulate without
 * bound, which makes silent truncation a question of when rather than whether.
 */
export const conversationListResponseSchema = z
  .object({
    conversations: z.array(
      conversationSchema.extend({
        // Listed rows carry the newest assistant message when it might hold an
        // ask block, so the rail can badge a chat that is waiting on an answer.
        // Only this route computes it; fetching one conversation does not.
        ask_candidate: z.string().nullable(),
      })
    ),
    /**
     * How many chats each lifecycle scope holds under the same filters, with
     * `state` ignored. `counts[state]` is the total for what was asked, so a
     * client can tell a complete list from a truncated one; the other two let
     * a rail label a scope it is not currently showing.
     */
    counts: z.object({
      open: z.number().int(),
      done: z.number().int(),
      all: z.number().int(),
    }),
  })
  .openapi('ConversationListResponse');

/** Path params for routes with :id (platform conversation ID). */
export const conversationIdParamsSchema = z.object({ id: z.string() });

/** POST /api/conversations request body. Uses strict() to reject unknown fields (e.g. conversationId). */
export const createConversationBodySchema = z
  .object({
    codebaseId: z.string().optional(),
    message: z.string().optional(),
  })
  .strict()
  .openapi('CreateConversationBody');

/** POST /api/conversations response. */
export const createConversationResponseSchema = z
  .object({
    conversationId: z.string(),
    id: z.string(),
    dispatched: z.boolean().optional(),
  })
  .openapi('CreateConversationResponse');

/**
 * PATCH /api/conversations/:id request body.
 *
 * `color: null` clears the color — distinct from omitting the field, which
 * leaves it untouched. Without that distinction a color could be set but never
 * removed.
 *
 * `archived` and `completed` are separate fields because they are separate
 * questions: done says the chat's unit of work landed, archived says stop
 * listing it. Either can be true without the other.
 */
export const updateConversationBodySchema = z
  .object({
    title: z.string().min(1).optional(),
    color: conversationColorSchema.nullable().optional(),
    // true archives, false restores. Omitted leaves the state alone, so a
    // rename cannot accidentally resurrect an archived chat.
    archived: z.boolean().optional(),
    // true marks the chat's unit of work finished, false reopens it. Omitted
    // leaves it alone — the same rule as `archived`, and for the same reason:
    // a rename must not decide whether the work is done.
    completed: z.boolean().optional(),
  })
  .openapi('UpdateConversationBody');

/**
 * PUT /api/conversations/order request body.
 *
 * `ids` is a RUN of chats as the rail is showing them, top first — not the
 * whole project. The rail displays one archive scope at a time, so it can only
 * speak for what it can see; the server rearranges those chats within the
 * positions they already hold and leaves every other chat alone.
 *
 * Capped at 200 because the list route returns at most 50: a longer body is a
 * client bug or an attempt to make one request rewrite a whole table.
 */
export const setConversationOrderBodySchema = z
  .object({
    ids: z.array(z.string()).min(1).max(200),
  })
  .strict()
  .openapi('SetConversationOrderBody');

/** Generic success response. */
export const successResponseSchema = z.object({ success: z.boolean() }).openapi('SuccessResponse');

/** A single message row (wire shape). */
export const messageSchema = messageRowSchema
  .extend({
    created_at: z.string().datetime(),
  })
  .openapi('Message');

/** GET /api/conversations/:id/messages query params. */
export const listMessagesQuerySchema = z.object({
  limit: z.string().optional(),
});

/** GET /api/conversations/:id/messages response. */
export const messageListResponseSchema = z.array(messageSchema).openapi('MessageListResponse');

/** POST /api/conversations/:id/message JSON request body. */
export const sendMessageBodySchema = z
  .object({ message: z.string().min(1) })
  .openapi('SendMessageBody');

/** POST /api/conversations/:id/message multipart request body (file uploads). */
export const sendMessageMultipartSchema = z
  .object({
    message: z.string().min(1),
    files: z
      .array(z.string().openapi({ format: 'binary' }))
      .max(5)
      .optional()
      .openapi({ description: 'Maximum 5 files; each file must be ≤ 10 MB' }),
  })
  .openapi('SendMessageMultipartBody');

/** Response for dispatch endpoints (send message, run workflow). */
export const dispatchResponseSchema = z
  .object({
    accepted: z.boolean(),
    status: z.string(),
  })
  .openapi('DispatchResponse');
