/**
 * oklch <-> sRGB, and WCAG contrast.
 *
 * Every colour in `tokens.css` is authored in oklch, because that is the space
 * where a lightness ladder reads as evenly spaced. Contrast, however, is
 * defined on sRGB relative luminance, so a generator that has to guarantee AA
 * has to cross between the two. These are the conversions, and nothing else.
 *
 * Formulae are Björn Ottosson's published oklab matrices. They are exact
 * transforms, not approximations, so a round trip returns the input within
 * floating-point error — `color.test.ts` holds them to that.
 */

/** A colour as three 0-255 sRGB channels. */
export type Rgb = readonly [number, number, number];
/** Lightness 0-1, chroma, hue in degrees. */
export type Oklch = readonly [number, number, number];

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * Out-of-gamut oklch values are clipped per channel rather than rejected.
 *
 * A saturated hue at an extreme lightness has no sRGB representation, and the
 * generator reaches those on purpose while lifting an accent toward AA. Clipping
 * desaturates rather than failing, which is the behaviour a colour picker needs:
 * the user still gets a colour, and the AA check that follows is run against
 * what will actually be painted.
 */
export function oklchToRgb([l, c, h]: Oklch): Rgb {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  // `lCone`/`mCone`/`sCone` are Ottosson's l'/m'/s' — the cone responses,
  // cubed back out of the nonlinear space.
  const lCone = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mCone = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sCone = (l - 0.089484177 * a - 1.291485548 * b) ** 3;
  const lr = 4.0767416621 * lCone - 3.3077115913 * mCone + 0.2309699292 * sCone;
  const lg = -1.2684380046 * lCone + 2.6097574011 * mCone - 0.3413193965 * sCone;
  const lb = -0.0041960863 * lCone - 0.7034186147 * mCone + 1.707614701 * sCone;
  const gamma = (v: number): number => {
    const x = clamp01(v);
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  };
  return [
    Math.round(gamma(lr) * 255),
    Math.round(gamma(lg) * 255),
    Math.round(gamma(lb) * 255),
  ] as const;
}

export function rgbToOklch([r, g, b]: Rgb): Oklch {
  const lin = (v: number): number => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const lr = lin(r);
  const lg = lin(g);
  const lb = lin(b);
  const lCone = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const mCone = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const sCone = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const l = 0.2104542553 * lCone + 0.793617785 * mCone - 0.0040720468 * sCone;
  const a = 1.9779984951 * lCone - 2.428592205 * mCone + 0.4505937099 * sCone;
  const bb = 0.0259040371 * lCone + 0.7827717662 * mCone - 0.808675766 * sCone;
  const hue = (Math.atan2(bb, a) * 180) / Math.PI;
  return [l, Math.hypot(a, bb), hue < 0 ? hue + 360 : hue] as const;
}

/** `#RRGGBB`, uppercase. The form every token in `tokens.css` is written in. */
export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0').toUpperCase()).join('')}`;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Returns null rather than throwing or guessing: the only caller that matters
 * is a user-typed hex field, where "not a colour yet" is the normal state
 * during typing and must not blow up the render.
 */
export function parseHex(hex: string): Rgb | null {
  if (!HEX_RE.test(hex)) return null;
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ] as const;
}

/** WCAG 2.1 relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  const lin = (v: number): number => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1:1 to 21:1. Order-independent. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
