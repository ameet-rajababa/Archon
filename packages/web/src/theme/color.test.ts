import { describe, expect, it } from 'bun:test';
import {
  contrastRatio,
  luminance,
  oklchToRgb,
  parseHex,
  rgbToOklch,
  toHex,
  type Rgb,
} from './color';

describe('oklch <-> sRGB', () => {
  it('round-trips a saturated colour within a channel step', () => {
    const start: Rgb = [0x5e, 0x6a, 0xd2];
    const back = oklchToRgb(rgbToOklch(start));
    for (const i of [0, 1, 2]) expect(Math.abs(back[i] - start[i])).toBeLessThanOrEqual(1);
  });

  it('round-trips the achromatic ends exactly', () => {
    expect(toHex(oklchToRgb(rgbToOklch([255, 255, 255])))).toBe('#FFFFFF');
    expect(toHex(oklchToRgb(rgbToOklch([0, 0, 0])))).toBe('#000000');
  });

  // The value tokens.css authors as --ln-accent. If this drifts, every
  // generated theme drifts with it.
  it('converts the authored accent to the expected hex', () => {
    expect(toHex(oklchToRgb([0.58, 0.145, 278]))).toBe('#686ECE');
  });

  it('clips out-of-gamut values instead of producing channels outside 0-255', () => {
    const rgb = oklchToRgb([0.95, 0.4, 145]);
    for (const c of rgb) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(255);
      expect(Number.isInteger(c)).toBe(true);
    }
  });

  it('reports lightness monotonically as L rises', () => {
    const ls = [0.1, 0.3, 0.5, 0.7, 0.9].map(l => luminance(oklchToRgb([l, 0.05, 265])));
    for (let i = 1; i < ls.length; i++) expect(ls[i]).toBeGreaterThan(ls[i - 1] as number);
  });
});

describe('parseHex', () => {
  it('accepts six-digit hex in either case', () => {
    expect(parseHex('#5E6AD2')).toEqual([94, 106, 210]);
    expect(parseHex('#5e6ad2')).toEqual([94, 106, 210]);
  });

  // A half-typed value in a colour field is the normal case, not an error.
  it('returns null for anything else rather than throwing', () => {
    for (const bad of ['#5E6AD', '5E6AD2', '#GGGGGG', '', '#5E6AD22', 'rebeccapurple']) {
      expect(parseHex(bad)).toBeNull();
    }
  });
});

describe('contrastRatio', () => {
  it('gives 21:1 for black on white, in both orders', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
  });

  it('gives 1:1 for a colour against itself', () => {
    expect(contrastRatio([94, 106, 210], [94, 106, 210])).toBeCloseTo(1, 10);
  });

  // The measurement that drove the lifted-indigo decision: Linear's signature
  // accent is NOT a usable text colour on the dark background.
  it('confirms the raw accent fails AA as text on the dark background', () => {
    expect(contrastRatio([0x5e, 0x6a, 0xd2], [0x09, 0x0a, 0x0c])).toBeLessThan(4.5);
  });
});
