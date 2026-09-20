/**
 * A project's colour and glyph.
 *
 * Colour moved from chats to projects: a chat is a thing you read once, a
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
 */
import { tileColor } from './icon-color';

const KEY = 'archon.console.projectIdentity';

/** Ten presets, matching the picker's top row. Names are kept because a swatch alone is not accessible. */
export const IDENTITY_COLORS: readonly { key: string; value: string }[] = [
  { key: 'grey', value: 'oklch(0.72 0.02 265)' },
  { key: 'slate', value: 'oklch(0.66 0.04 250)' },
  { key: 'indigo', value: 'oklch(0.58 0.17 275)' },
  { key: 'cyan', value: 'oklch(0.70 0.12 215)' },
  { key: 'green', value: 'oklch(0.70 0.14 160)' },
  { key: 'yellow', value: 'oklch(0.80 0.14 92)' },
  { key: 'orange', value: 'oklch(0.70 0.15 55)' },
  { key: 'pink', value: 'oklch(0.75 0.11 5)' },
  { key: 'red', value: 'oklch(0.64 0.19 25)' },
  { key: 'plum', value: 'oklch(0.58 0.14 325)' },
];

export interface ProjectIdentity {
  /** A key from IDENTITY_COLORS, or null to use the deterministic default. */
  color: string | null;
  /** A glyph name the rail knows how to draw, or null for the default. */
  glyph: string | null;
}

type Store = Record<string, ProjectIdentity>;

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
export function getIdentity(projectId: string): ProjectIdentity {
  return read()[projectId] ?? { color: null, glyph: null };
}

export function setIdentity(projectId: string, next: Partial<ProjectIdentity>): void {
  const store = read();
  const current = store[projectId] ?? { color: null, glyph: null };
  store[projectId] = { ...current, ...next };
  write(store);
}

export function clearIdentity(projectId: string): void {
  const store = read();
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- keys are project ids
  delete store[projectId];
  write(store);
}

/**
 * The colour to actually paint, resolving a chosen key to its value and
 * falling back to the id-derived default. Never returns null, so a row always
 * has a colour and the rail never renders a hole.
 */
export function resolveColor(projectId: string, identity?: ProjectIdentity): string {
  const chosen = (identity ?? getIdentity(projectId)).color;
  if (chosen !== null) {
    const hit = IDENTITY_COLORS.find(c => c.key === chosen);
    if (hit !== undefined) return hit.value;
  }
  // The default spreads across the identity palette rather than reusing
  // `tileColor`, whose hues are deliberately concentrated in the warm end.
  // That is correct for a tinted monogram tile and wrong for a bare glyph:
  // six warm glyphs down a rail read as one colour repeated.
  let h = 0;
  for (let i = 0; i < projectId.length; i++) h = (h * 33 + projectId.charCodeAt(i)) >>> 0;
  // Skip `grey` — a project that chose grey means it; one that was assigned it
  // looks unconfigured.
  const pool = IDENTITY_COLORS.slice(1);
  return pool[h % pool.length]?.value ?? tileColor(projectId);
}
