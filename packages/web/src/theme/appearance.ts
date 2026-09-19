import { useSyncExternalStore } from 'react';

/**
 * Appearance preferences — theme family and light/dark mode.
 *
 * Three independent axes, deliberately not one setting:
 *
 *   theme   archon | linear            which palette family
 *   mode    light  | dark | system     `system` is a RESOLVER, not a palette
 *   text    small  | default | large   stored, but NOT yet exposed — see below
 *
 * `system` never reaches CSS. The stored preference is one of three values, but
 * `data-mode` on <html> only ever carries `light` or `dark`, so tokens.css needs
 * exactly two blocks per family rather than three.
 *
 * `text` is persisted and applied, but no control offers it yet: 597 of the
 * console's 931 text sizes are arbitrary pixel literals (`text-[10.5px]`) which
 * ignore a root font-size. A size control today would move about a third of the
 * text on screen, which is worse than not having one. The picker arrives with
 * the type sweep that converts them.
 *
 * Backed by localStorage like every other console UI preference (rail width,
 * clock format, sticky project view). It is a rendering choice, not data, and
 * it deliberately does not follow between devices.
 *
 * THE SAME LOGIC RUNS TWICE. index.html carries an inline copy that runs before
 * first paint — an imported module cannot, which is the entire point, since
 * without it every reload flashes the wrong theme. Keep the two in step.
 */

export type ThemeName = 'archon' | 'linear';
export type ModePref = 'light' | 'dark' | 'system';
export type TextSize = 'small' | 'default' | 'large';

export interface Appearance {
  theme: ThemeName;
  mode: ModePref;
  text: TextSize;
}

const KEY = 'archon.console.appearance';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Linear is the default: the neutral palette is the ask, the brand is opt-in. */
export const DEFAULTS: Appearance = { theme: 'linear', mode: 'system', text: 'default' };

/** Anything unrecognised — a stale key, a hand-edited value — falls back. */
export function parseAppearance(raw: string | null | undefined): Appearance {
  if (raw === null || raw === undefined) return DEFAULTS;
  try {
    const p: unknown = JSON.parse(raw);
    if (typeof p !== 'object' || p === null) return DEFAULTS;
    const o = p as Record<string, unknown>;
    const theme = o.theme === 'archon' || o.theme === 'linear' ? o.theme : DEFAULTS.theme;
    const mode =
      o.mode === 'light' || o.mode === 'dark' || o.mode === 'system' ? o.mode : DEFAULTS.mode;
    const text =
      o.text === 'small' || o.text === 'default' || o.text === 'large' ? o.text : DEFAULTS.text;
    return { theme, mode, text };
  } catch {
    return DEFAULTS;
  }
}

/** Collapse the three-value preference to the two values CSS understands. */
export function resolveMode(mode: ModePref, prefersDark: boolean): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  return prefersDark ? 'dark' : 'light';
}

const listeners = new Set<() => void>();
let current: Appearance | null = null;

function read(): Appearance {
  try {
    return parseAppearance(localStorage.getItem(KEY));
  } catch {
    // Storage throws with cookies disabled and in some private-browsing modes.
    return DEFAULTS;
  }
}

export function getAppearance(): Appearance {
  current ??= read();
  return current;
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    return true;
  }
}

/** Write the resolved values onto <html>, where tokens.css reads them. */
export function applyAppearance(a: Appearance = getAppearance()): void {
  const r = document.documentElement;
  r.dataset.theme = a.theme;
  r.dataset.mode = resolveMode(a.mode, systemPrefersDark());
  r.dataset.text = a.text;
  // The inline pre-paint script set this to avoid a flash; keep it honest so a
  // later mode change does not leave the old colour behind the app.
  r.style.background = '';
}

export function setAppearance(patch: Partial<Appearance>): void {
  const next: Appearance = { ...getAppearance(), ...patch };
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Best-effort: failing to remember the choice must not break rendering.
  }
  applyAppearance(next);
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Follow the OS while `mode` is `system`. Without this the console only notices
 * an OS change on reload — the part implementations usually forget. Called once
 * at startup; there is nothing to unsubscribe from for the app's lifetime.
 */
export function watchSystemMode(): void {
  try {
    window.matchMedia(DARK_QUERY).addEventListener('change', () => {
      if (getAppearance().mode !== 'system') return;
      applyAppearance();
      for (const l of listeners) l();
    });
  } catch {
    // No matchMedia: `system` simply resolves once, at load.
  }
}

/** The active preference, re-rendering the caller when it changes. */
export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, getAppearance, getAppearance);
}
