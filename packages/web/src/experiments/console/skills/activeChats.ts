/**
 * Which conversations the server is actively working on, right now.
 *
 * `/api/health` already reports this — `concurrency.activeConversationIds` —
 * and the ids are platform ids (`web-<ts>-<rand>`), the same ones the rail
 * keys its rows by. It is not in the generated OpenAPI schema, so the shape is
 * declared here rather than derived, and read defensively: a missing or
 * malformed field yields an empty set, never an exception.
 */
import { requestJson } from '../lib/http';

interface HealthConcurrency {
  concurrency?: { activeConversationIds?: unknown };
}

export async function getActiveChatIds(): Promise<readonly string[]> {
  const res = await requestJson<HealthConcurrency>('/api/health');
  const raw = res.concurrency?.activeConversationIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string');
}
