/**
 * What the server is working on, right now, across every conversation.
 *
 * `/api/health` reports both halves — `concurrency.activeConversationIds` says
 * WHICH chats are moving, `concurrency.activeTools` says what each is doing —
 * and the ids are platform ids (`web-<ts>-<rand>`), the same ones the rail keys
 * its rows by. Neither is in the generated OpenAPI schema, so the shape is
 * declared here rather than derived, and read defensively: a missing or
 * malformed field yields nothing, never an exception.
 */
import { requestJson } from '../lib/http';

interface HealthConcurrency {
  concurrency?: { activeConversationIds?: unknown; activeTools?: unknown };
}

/** The tool a chat is running, as the strip and the rail need it described. */
export interface ActiveTool {
  name: string;
  input: Record<string, string>;
}

export interface ActiveChats {
  ids: readonly string[];
  /** Keyed by platform conversation id. Absent for a chat between tools. */
  tools: Readonly<Record<string, ActiveTool>>;
}

function parseTools(raw: unknown): Record<string, ActiveTool> {
  const out: Record<string, ActiveTool> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const { name, input } = value as { name?: unknown; input?: unknown };
    if (typeof name !== 'string' || name === '') continue;
    // The server bounds the input to short strings; anything else is dropped
    // rather than rendered, because this only ever becomes one short line.
    const fields: Record<string, string> = {};
    if (typeof input === 'object' && input !== null) {
      for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
        if (typeof v === 'string') fields[k] = v;
      }
    }
    out[id] = { name, input: fields };
  }
  return out;
}

export async function getActiveChats(): Promise<ActiveChats> {
  const res = await requestJson<HealthConcurrency>('/api/health');
  const raw = res.concurrency?.activeConversationIds;
  const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  return { ids, tools: parseTools(res.concurrency?.activeTools) };
}
