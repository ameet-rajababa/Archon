/**
 * A project's color and glyph.
 *
 * Color moved from chats to projects: a chat is a thing you read once, a
 * project is a thing you navigate to for months, so the stable identity belongs
 * on the project. Chats are monochrome now.
 *
 * Stored in localStorage, not on the server. The `codebases` table has no
 * column for either, and adding one costs a migration, a server patch and a
 * container restart — none of which should block the rail. The consequence is
 * honest and worth stating: a chosen icon does not follow you to another
 * machine. Everything here degrades to the deterministic default, so an
 * unconfigured browser still renders a sensible rail rather than a blank one.
 *
 * Same storage shape as `archon.console.chatOrder.*` and the rail width, so it
 * lifts to the server later without the callers changing.
 *
 * The identity vocabulary itself — the type, the presets, the resolution rules
 * — lives in `identity.ts`, shared with the assistant's identity.
 */
import { UNSET, resolveIdentityColor, type Identity } from './identity';

const KEY = 'archon.console.projectIdentity';

type Store = Record<string, Identity>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    // Anything but an object means a corrupted or foreign value; start clean
    // rather than throw on every render.
    return typeof parsed === 'object' && parsed !== null ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* private mode / quota — the rail still works, the choice just doesn't persist */
  }
}

/** The stored identity for a project, or an all-null one when nothing is set. */
export function getIdentity(projectId: string): Identity {
  return read()[projectId] ?? UNSET;
}

export function setIdentity(projectId: string, next: Partial<Identity>): void {
  const store = read();
  const current = store[projectId] ?? UNSET;
  store[projectId] = { ...current, ...next };
  write(store);
}

export function clearIdentity(projectId: string): void {
  const store = read();
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- keys are project ids
  delete store[projectId];
  write(store);
}

/** The color to paint a project with. Never null — see `resolveIdentityColor`. */
export function resolveColor(projectId: string, identity?: Identity): string {
  return resolveIdentityColor(projectId, identity ?? getIdentity(projectId));
}
