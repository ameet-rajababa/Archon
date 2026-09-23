/**
 * A theme, generated from three inputs.
 *
 * Before this, every theme was about fifty hand-authored oklch literals per
 * mode, which is why there were exactly two of them and no custom one: a user
 * cannot hand-author fifty values. A theme is now `{ accent, background,
 * contrast }`, and the ladder between them is computed.
 *
 * The semantic names and their positions are NOT new. They were already a
 * 13-step ramp (`--ln-0 … --ln-12`) with each token pointing at a step; this
 * replaces the literal ramp with the function that produces it, and nothing
 * else. `generate.test.ts` holds the output to the values it replaced.
 *
 * Light/dark is DERIVED from the background's lightness rather than stored.
 * That is what lets the theme list be flat — "System preference" can sit
 * beside "Magic Blue" only if picking a background is picking a polarity.
 */
import {
  contrastRatio,
  oklchToRgb,
  parseHex,
  rgbToOklch,
  toHex,
  type Oklch,
  type Rgb,
} from './color';

export type Polarity = 'light' | 'dark';

export interface ThemeInput {
  /** Fill colour for accents. Used exactly as given; only text derives from it. */
  accent: string;
  /** The page background. Its lightness decides the polarity. */
  background: string;
  /** 0-100. Shapes the surface ladder; text is floored at AA regardless. */
  contrast: number;
}

/** Every token the generator owns. Keys are the CSS custom property names. */
export type GeneratedTokens = Record<TokenName, string>;

export type TokenName =
  | 'background'
  | 'surface'
  | 'surface-inset'
  | 'surface-elevated'
  | 'surface-variant'
  | 'surface-hover'
  | 'surface-bright'
  | 'border'
  | 'border-bright'
  | 'outline-variant'
  | 'text-primary'
  | 'text-secondary'
  | 'text-tertiary'
  | 'accent'
  | 'accent-bright'
  | 'accent-hover';

/**
 * Ladder positions: 0 is the background, 1 is primary text.
 *
 * TWO vectors, not one. Light packs four surface steps into its first 0.11 of
 * lightness while dark spreads three across 0.21 — on white you need very
 * small separations to read as separate surfaces, and on near-black you need
 * large ones. Sharing a curve between them makes generated light themes muddy.
 * Both were measured off the `--ln-*` ramp this replaces.
 *
 * `surface-inset` is NEGATIVE in dark: the recessed surface is darker than the
 * page, while in light it is darker too — which is why the sign differs but
 * the direction of "recessed" does not.
 */
const SHAPE: Record<
  Polarity,
  Record<Exclude<TokenName, 'accent' | 'accent-bright' | 'accent-hover' | 'background'>, number>
> = {
  dark: {
    'surface-inset': -0.03,
    surface: 0,
    'surface-elevated': 0.055,
    'surface-variant': 0.055,
    'surface-hover': 0.133,
    'surface-bright': 0.212,
    border: 0.133,
    'border-bright': 0.212,
    'outline-variant': 0.406,
    'text-tertiary': 0.595,
    'text-secondary': 0.77,
    'text-primary': 1,
  },
  light: {
    'surface-inset': 0.054,
    surface: 0,
    'surface-elevated': 0.006,
    'surface-variant': 0.045,
    'surface-hover': 0.071,
    'surface-bright': 0.128,
    border: 0.109,
    'border-bright': 0.282,
    'outline-variant': 0.487,
    'text-tertiary': 0.604,
    'text-secondary': 0.667,
    'text-primary': 1,
  },
};

/**
 * Lightness span at contrast 100, calibrated so that contrast 95 — the value
 * Linear's own slider ships at — reproduces the span of the ramp this replaces.
 */
const SPAN: Record<Polarity, number> = { dark: 0.825 / 0.95, light: 0.78 / 0.95 };

/**
 * Surfaces carry a trace of the background's hue and no more.
 *
 * "Chroma stays at or below 0.008 on every surface" was the stated restraint of
 * the palette this generalises, and it is the whole easy-on-the-eyes property.
 * A user picking a vivid background must not be able to defeat it, so this is
 * a cap applied to the derived surfaces — not to the background itself, which
 * is painted exactly as chosen.
 */
const MAX_SURFACE_CHROMA = 0.008;
const MAX_TEXT_CHROMA = 0.004;

/**
 * A background with no chroma carries no hue to inherit, and generating from
 * `#FFFFFF` produced flat neutral greys — the light theme this replaces got
 * its faint cool cast from the ramp's fixed hue, not from its white background.
 * So the cast is its own default, and only a background that actually has a
 * hue overrides it.
 */
const CAST_HUE = 265;
const CAST_CHROMA = 0.006;
const ACHROMATIC_BELOW = 0.002;

/** WCAG AA for body text. The floor every text token is held to. */
export const AA = 4.5;

/** Lightness below which a background reads as dark. */
const DARK_BELOW = 0.5;

export function polarityOf(background: string): Polarity {
  const rgb = parseHex(background);
  if (rgb === null) return 'dark';
  return rgbToOklch(rgb)[0] < DARK_BELOW ? 'dark' : 'light';
}

/**
 * Walk lightness in `dir` until the colour clears `target` against `against`.
 *
 * Returns null when the whole range is exhausted without clearing it, which
 * happens when a hue simply cannot reach the ratio — a dark accent on a dark
 * background. The caller decides what to substitute; silently returning the
 * failing colour would defeat the guarantee this exists to provide.
 */
function liftToContrast(start: Oklch, against: Rgb, dir: 1 | -1, target: number): Oklch | null {
  const [l0, c, h] = start;
  for (let i = 0; i <= 200; i++) {
    const l = l0 + dir * i * 0.005;
    if (l < 0 || l > 1) break;
    if (contrastRatio(oklchToRgb([l, c, h]), against) >= target) return [l, c, h];
  }
  return null;
}

/**
 * Build a full token set.
 *
 * Invalid hex falls back rather than throwing: the caller is a live colour
 * field, and a half-typed value must render something instead of crashing the
 * app mid-keystroke.
 */
export function generateTheme(input: ThemeInput): GeneratedTokens {
  const bgRgb = parseHex(input.background) ?? ([9, 10, 12] as const);
  const accentRgb = parseHex(input.accent) ?? ([94, 106, 210] as const);
  const [bgL, bgChroma, bgHue] = rgbToOklch(bgRgb);

  const polarity: Polarity = bgL < DARK_BELOW ? 'dark' : 'light';
  const dir: 1 | -1 = polarity === 'dark' ? 1 : -1;
  const contrast = Math.min(100, Math.max(0, input.contrast));
  const span = SPAN[polarity] * (contrast / 100);

  const achromatic = bgChroma < ACHROMATIC_BELOW;
  const hue = achromatic ? CAST_HUE : bgHue;
  const cast = achromatic ? CAST_CHROMA : bgChroma;

  const out = {} as GeneratedTokens;
  for (const [name, position] of Object.entries(SHAPE[polarity])) {
    const l = Math.min(1, Math.max(0, bgL + dir * position * span));
    const isText = name.startsWith('text');
    const chroma = Math.min(cast, isText ? MAX_TEXT_CHROMA : MAX_SURFACE_CHROMA);
    out[name as TokenName] = toHex(oklchToRgb([l, chroma, hue]));
  }
  // The page background is the user's colour untouched — capping its chroma
  // would silently repaint the one value they picked most deliberately.
  // `--surface` is the same plane, so it is that colour and not a regenerated
  // approximation of it: derived from the cast instead, "Pure Light" came out
  // #FDFFFF rather than white, which is the one thing its name promises.
  out.background = toHex(oklchToRgb([bgL, bgChroma, bgHue]));
  out.surface = out.background;

  /**
   * TEXT IS FLOORED AT AA, whatever the contrast slider says.
   *
   * Contrast shapes the SURFACE ladder. Letting it drag text down with it puts
   * primary text at 2.67:1 by contrast 30 — measured, not feared. Linear can
   * ship a sidebar at 30 because a sidebar carries almost no body text. So the
   * slider keeps its full range and its visible effect on surfaces, and text is
   * lifted back when the ladder puts it below the floor. Above roughly 75 this
   * never engages, which is why it does not disturb the default themes.
   */
  const surfaceRgb = parseHex(out.surface) ?? bgRgb;
  for (const name of ['text-primary', 'text-secondary', 'text-tertiary'] as const) {
    const current = parseHex(out[name]);
    if (current === null) continue;
    if (contrastRatio(current, surfaceRgb) >= AA) continue;
    const lifted = liftToContrast(rgbToOklch(current), surfaceRgb, dir, AA);
    // Nothing in this hue reaches AA: take the extreme, which is the most
    // readable value available rather than the unreadable one we started with.
    out[name] = toHex(oklchToRgb(lifted ?? [polarity === 'dark' ? 1 : 0, 0, hue]));
  }

  /**
   * The accent fill is exactly what was picked. `--accent-bright` is the same
   * hue lifted until it clears AA as text on `--surface-hover`, the busiest
   * surface it lands on. That lift used to be done by hand and recorded in a
   * comment; doing it here is what makes an arbitrary custom accent safe.
   */
  const [aL, aC, aH] = rgbToOklch(accentRgb);
  out.accent = toHex(oklchToRgb([aL, aC, aH]));
  const against = parseHex(out['surface-hover']) ?? surfaceRgb;
  const bright = liftToContrast([aL, aC, aH], against, dir, AA);
  // An accent too close to its background has no readable variant in its own
  // hue. Primary text is the honest substitute: readable by construction, and
  // the fill still shows the colour that was chosen.
  out['accent-bright'] = bright === null ? out['text-primary'] : toHex(oklchToRgb(bright));
  out['accent-hover'] = toHex(oklchToRgb([Math.min(1, Math.max(0, aL + dir * 0.06)), aC, aH]));

  return out;
}

/** The token set as CSS declarations, for both the build step and the runtime. */
export function tokensToCss(tokens: GeneratedTokens): string {
  return Object.entries(tokens)
    .map(([name, value]) => `--${name}: ${value};`)
    .join('\n  ');
}
