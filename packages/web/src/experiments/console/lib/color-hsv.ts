/**
 * HSV ↔ hex, for the identity picker's custom color.
 *
 * A saturation/value field and a hue rail are HSV by construction: the two
 * axes of the square ARE s and v, and the rail IS h. Storing the result as
 * hex keeps the persisted value something a person can read, type and paste,
 * which is the whole point of showing the readout.
 *
 * The presets are oklch and stay that way — they were chosen by eye in oklch
 * and converting them to hex would quietly change them. `hexToHsv` returns
 * null for anything that is not `#rrggbb`, which is how a preset is told from
 * a custom color everywhere this is used.
 */

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export interface Hsv {
  /** Degrees, 0–360. */
  h: number;
  /** 0–1. */
  s: number;
  /** 0–1. */
  v: number;
}

/** Lowercase `#rrggbb`. */
export function hsvToHex(h: number, s: number, v: number): string {
  return `#${hsvToRgb(h, s, v)
    .map(n => n.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Parse `#rrggbb` (with or without the hash, any case), or null if it is not one. */
export function hexToHsv(value: string): Hsv | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (m === null) return null;
  const n = parseInt(m[1] ?? '', 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    h =
      max === r
        ? 60 * (((g - b) / d) % 6)
        : max === g
          ? 60 * ((b - r) / d + 2)
          : 60 * ((r - g) / d + 4);
  }
  return { h: ((h % 360) + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
}

/** True for a literal color this app stores verbatim, rather than a preset key. */
export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}
