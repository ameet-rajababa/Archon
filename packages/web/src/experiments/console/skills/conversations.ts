import { requestJson, HttpError } from '../lib/http';
import {
  toConversationSummary,
  type ConversationColor,
  type ConversationSummary,
} from '../primitives/conversation';

/**
 * Conversation verbs for the project-scoped agent chat.
 *
 * This is the second place (after startRun.ts) where the legacy "conversation"
 * concept lives in the console. A chat makes the conversation a first-class
 * entity, so these verbs are the sanctioned home for create / list / send.
 *
 *   - createConversation: POST /api/conversations. When `message` is supplied
 *     the backend dispatches it to the orchestrator atomically and the response
 *     also carries dispatch fields (ignored here). Sends multipart when files
 *     are attached, so the first message of a new chat can carry them.
 *     `conversationId` is the platform id used by every other conversation route.
 *   - renameConversation: PATCH /api/conversations/:id — sets the title,
 *     replacing the server's auto-generated one.
 *   - setConversationColor: PATCH /api/conversations/:id — sets or clears the
 *     color label. An explicit null clears it; omitting it leaves it alone.
 *   - listConversations:  GET /api/conversations?codebaseId=<id>&mine=true
 *     (JSON array). `mine=true` is non-enforcing: it narrows to the signed-in
 *     user's conversations when an identity resolves (Better Auth cookie or
 *     X-Archon-User), so each user gets their own per-project chat on
 *     multi-user installs; with no identity (solo installs) nothing narrows.
 *   - sendMessage:        POST /api/conversations/:id/message. JSON, or
 *     multipart when files are attached (mirrors startRun's multipart path).
 */

/**
 * POST a FormData body and decode the JSON reply.
 *
 * Deliberately not `requestJson`: the Content-Type header must be left unset so
 * the browser can add the multipart boundary. Mirrors requestJson's error
 * decoding so both paths raise the same HttpError.
 */
async function postMultipart<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let parsed: { error?: string } = {};
    try {
      parsed = JSON.parse(text) as { error?: string };
    } catch {
      /* not JSON */
    }
    const raw = parsed.error ?? (text.length > 0 ? text : `HTTP ${res.status.toString()}`);
    const msg = raw.length > 200 ? `${raw.slice(0, 200)}...` : raw;
    const path = new URL(url, window.location.origin).pathname;
    throw new HttpError(res.status, path, msg);
  }
  return (await res.json()) as T;
}

interface CreateConversationResponse {
  conversationId: string;
  id: string;
}

export async function createConversation(
  projectId: string,
  message?: string,
  files?: File[]
): Promise<CreateConversationResponse> {
  if (message !== undefined && files !== undefined && files.length > 0) {
    const form = new FormData();
    form.append('codebaseId', projectId);
    form.append('message', message);
    for (const file of files) {
      form.append('files', file, file.name);
    }
    return postMultipart<CreateConversationResponse>('/api/conversations', form);
  }
  return requestJson<CreateConversationResponse>('/api/conversations', {
    method: 'POST',
    body: JSON.stringify(
      message !== undefined ? { codebaseId: projectId, message } : { codebaseId: projectId }
    ),
  });
}

/**
 * A project's chats, filtered by where they are in their lifecycle.
 *
 * `archived=active` is not a choice the console offers any more — it never
 * lists a soft-deleted row. Deleting a chat is an API operation with no
 * control in the rail, so a deleted chat is gone from the console rather than
 * sitting in a scope nothing navigates to.
 */
export async function listConversations(
  projectId: string,
  state: 'open' | 'done' | 'all' = 'open'
): Promise<ConversationSummary[]> {
  const raw = await requestJson<Parameters<typeof toConversationSummary>[0][]>(
    `/api/conversations?codebaseId=${encodeURIComponent(projectId)}&mine=true&archived=active&state=${state}`
  );
  return raw.map(toConversationSummary);
}

/**
 * Arrange a run of chats: `ids` is the order they should appear in, top first.
 *
 * Only the chats the rail is showing are named. The server rearranges them
 * within the positions they already hold, so chats in another archive scope —
 * which this rail cannot see and must not speak for — keep their places.
 */
export async function setConversationOrder(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await requestJson<{ success: boolean }>('/api/conversations/order', {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  });
}

/**
 * Mark a chat's unit of work finished, or reopen it.
 *
 * The console's whole chat lifecycle: a chat is open or done, and this is the
 * only thing that moves it either way. Marking it done takes it out of the
 * default list, which is the job archiving used to do under a second name.
 */
export async function setConversationCompleted(
  conversationPlatformId: string,
  completed: boolean
): Promise<void> {
  await requestJson<{ success: boolean }>(
    `/api/conversations/${encodeURIComponent(conversationPlatformId)}`,
    { method: 'PATCH', body: JSON.stringify({ completed }) }
  );
}

export async function sendMessage(
  conversationPlatformId: string,
  message: string,
  files?: File[]
): Promise<void> {
  const url = `/api/conversations/${encodeURIComponent(conversationPlatformId)}/message`;

  if (files === undefined || files.length === 0) {
    await requestJson<{ accepted: boolean; status: string }>(url, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
    return;
  }

  const form = new FormData();
  form.append('message', message);
  for (const file of files) {
    form.append('files', file, file.name);
  }
  await postMultipart<{ accepted: boolean; status: string }>(url, form);
}

/**
 * Rename a conversation. The server auto-titles from the first message; this
 * overwrites that with the user's own wording and it sticks.
 */
export async function renameConversation(
  conversationPlatformId: string,
  title: string
): Promise<void> {
  await requestJson<{ success: boolean }>(
    `/api/conversations/${encodeURIComponent(conversationPlatformId)}`,
    { method: 'PATCH', body: JSON.stringify({ title }) }
  );
}

/**
 * Set or clear a conversation's color label. `null` clears it — the server
 * distinguishes an explicit null from an omitted field.
 */
export async function setConversationColor(
  conversationPlatformId: string,
  color: ConversationColor | null
): Promise<void> {
  await requestJson<{ success: boolean }>(
    `/api/conversations/${encodeURIComponent(conversationPlatformId)}`,
    { method: 'PATCH', body: JSON.stringify({ color }) }
  );
}
