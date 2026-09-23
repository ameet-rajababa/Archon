/**
 * Appearance preferences — which theme, and how dense the interface is.
 *
 *   theme     one of the five presets, `system`, or `custom`
 *   custom    the three inputs a custom theme is generated from
 *   text      xs | s | m | l | xl — scales the root font size
 *   density   comfortable | compact
 *
 * THERE IS NO `mode`. Light and dark are derived from the theme's background
 * lightness, not stored beside it. A background IS a polarity, and storing
 * both let them disagree — a custom theme has no sensible answer to "and is it
 * light or dark?" anyway. `data-mode` is still written to <html>, because 55
 * CSS rules key off it; it is now computed rather than chosen.
 *
 * `system` is a RESOLVER, not a palette: it selects between LIGHT_PRESET and
 * DARK_PRESET and follows the OS while it stays selected.
 *
 * Backed by localStorage like every other console UI preference (rail width,
 * clock format, sticky project view). It is a rendering choice, not data, and
 * it deliberately does not follow between devices.
 *
 * THE SAME RESOLUTION RUNS TWICE. index.html carries an inline copy that runs
 * before first paint — an imported module cannot, which is the entire point,
 * since without it every reload flashes the wrong theme. Keep the two in step.
 */
import { useSyncExternalStore } from 'react';
import { generateTheme, polarityOf, tokensToCss, type ThemeInput } from './generate';
import { DARK_PRESET, LIGHT_PRESET, presetById, type PresetId } from './presets';

export type ThemeChoice = PresetId | 'system' | 'custom';
export type TextSize = 'xs' | 's' | 'm' | 'l' | 'xl';

/**
 * How much air a row gets.
 *
 * The values are the token names in theme/tokens.css. `comfortable` is
 * labeled "Cozy" in the UI — the token keeps the CSS-conventional name, the
 * label uses the word people actually say.
 */
export type Density = 'comfortable' | 'compact';

export interface Appearance {
  theme: ThemeChoice;
  /** Only read when `theme` is `custom`; kept otherwise so a round trip through
   *  a preset and back does not discard what was configured. */
  custom: ThemeInput;
  text: TextSize;
  density: Density;
}

const KEY = 'archon.console.appearance';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const CUSTOM_STYLE_ID = 'archon-custom-theme';

const THEME_CHOICES: readonly ThemeChoice[] = [
  'pure-light',
  'light',
  'dark',
  'classic-dark',
  'magic-blue',
  'system',
  'custom',
];

/** Custom starts as a copy of the default dark theme rather than as blanks —
 *  an empty colour field on first open has nothing to adjust FROM. */
export const CUSTOM_DEFAULT: ThemeInput = {
  accent: '#5E6AD2',
  background: '#090A0C',
  contrast: 95,
};

export const DEFAULTS: Appearance = {
  theme: 'system',
  custom: CUSTOM_DEFAULT,
  text: 'm',
  density: 'comfortable',
};

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

function parseCustom(raw: unknown): ThemeInput {
  if (typeof raw !== 'object' || raw === null) return CUSTOM_DEFAULT;
  const o = raw as Record<string, unknown>;
  const contrast =
    typeof o.contrast === 'number' && Number.isFinite(o.contrast)
      ? o.contrast
      : CUSTOM_DEFAULT.contrast;
  return {
    accent: isHex(o.accent) ? o.accent : CUSTOM_DEFAULT.accent,
    background: isHex(o.background) ? o.background : CUSTOM_DEFAULT.background,
    contrast: Math.min(100, Math.max(0, contrast)),
  };
}

/**
 * Migrate the previous `{theme: archon|linear, mode: light|dark|system}` shape.
 *
 * The Archon family is gone, so its hue cannot be preserved. Its POLARITY can,
 * and that is the part a person actually notices on reload — waking up in the
 * opposite mode is jarring in a way a changed accent is not.
 */
function migrateLegacy(o: Record<string, unknown>): ThemeChoice | null {
  const legacyTheme = o.theme;
  if (legacyTheme !== 'archon' && legacyTheme !== 'linear') return null;
  if (o.mode === 'light') return 'light';
  if (o.mode === 'dark') return 'dark';
  return 'system';
}

/** Anything unrecognised — a stale key, a hand-edited value — falls back. */
export function parseAppearance(raw: string | null | undefined): Appearance {
  if (raw === null || raw === undefined) return DEFAULTS;
  try {
    const p: unknown = JSON.parse(raw);
    if (typeof p !== 'object' || p === null) return DEFAULTS;
    const o = p as Record<string, unknown>;
    const migrated = migrateLegacy(o);
    const theme: ThemeChoice =
      migrated ??
      (THEME_CHOICES.includes(o.theme as ThemeChoice) ? (o.theme as ThemeChoice) : DEFAULTS.theme);
    // A value from the old three-step scale, or anything else, falls back to
    // the default rather than leaving the attribute unset — an unset
    // [data-text] leaves --ui-scale undefined and the whole UI at 16px.
    const text: TextSize =
      o.text === 'xs' || o.text === 's' || o.text === 'm' || o.text === 'l' || o.text === 'xl'
        ? o.text
        : DEFAULTS.text;
    const density: Density =
      o.density === 'comfortable' || o.density === 'compact' ? o.density : DEFAULTS.density;
    return { theme, custom: parseCustom(o.custom), text, density };
  } catch {
    return DEFAULTS;
  }
}

export interface ResolvedTheme {
  /** What goes in `data-theme`. `system` never reaches CSS. */
  id: PresetId | 'custom';
  input: ThemeInput;
  polarity: 'light' | 'dark';
}

/** Collapse the preference to the theme CSS actually renders. */
export function resolveTheme(a: Appearance, prefersDark: boolean): ResolvedTheme {
  if (a.theme === 'custom') {
    return { id: 'custom', input: a.custom, polarity: polarityOf(a.custom.background) };
  }
  const id = a.theme === 'system' ? (prefersDark ? DARK_PRESET : LIGHT_PRESET) : a.theme;
  // A stale id from a hand-edited value must still render something.
  const preset = presetById(id) ?? presetById(DARK_PRESET);
  if (preset === undefined) return { id: DARK_PRESET, input: CUSTOM_DEFAULT, polarity: 'dark' };
  return { id: preset.id, input: preset, polarity: polarityOf(preset.background) };
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

/**
 * A custom theme has no compiled CSS block, so it gets one written at runtime.
 *
 * A <style> element rather than inline properties on <html>: the five presets
 * define their tokens ON `.console-root`, and an inherited value from an
 * ancestor loses to any of them. Matching their selector exactly means custom
 * and preset are interchangeable rather than subtly different.
 */
function writeCustomCss(input: ThemeInput): void {
  let el = document.getElementById(CUSTOM_STYLE_ID);
  if (el === null) {
    el = document.createElement('style');
    el.id = CUSTOM_STYLE_ID;
    document.head.appendChild(el);
  }
  const polarity = polarityOf(input.background);
  el.textContent = `[data-theme='custom'] .console-root {\n  color-scheme: ${polarity};\n  ${tokensToCss(generateTheme(input))}\n}`;
}

/** Write the resolved values onto <html>, where tokens.css reads them. */
export function applyAppearance(a: Appearance = getAppearance()): void {
  const r = document.documentElement;
  const resolved = resolveTheme(a, systemPrefersDark());
  if (resolved.id === 'custom') writeCustomCss(resolved.input);
  // Always set, never absent: a rule reading var(--row-y) with no
  // [data-density] ancestor silently computes to nothing, and every row
  // collapses to the height of its text.
  r.dataset.density = a.density;
  r.dataset.theme = resolved.id;
  r.dataset.mode = resolved.polarity;
  r.dataset.text = a.text;
  // The inline pre-paint script set this to avoid a flash; keep it honest so a
  // later theme change does not leave the old color behind the app.
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
 * Follow the OS while `theme` is `system`. Without this the console only
 * notices an OS change on reload — the part implementations usually forget.
 * Called once at startup; there is nothing to unsubscribe from for the app's
 * lifetime.
 */
export function watchSystemMode(): void {
  try {
    window.matchMedia(DARK_QUERY).addEventListener('change', () => {
      if (getAppearance().theme !== 'system') return;
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

/**
 * The polarity the page is ACTUALLY in, which is what a component needs when
 * it has to hand a light/dark value to something that cannot read CSS — a
 * canvas library, a chart, an iframe.
 */
export function useResolvedMode(): 'light' | 'dark' {
  return resolveTheme(useAppearance(), systemPrefersDark()).polarity;
}
