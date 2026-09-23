import { describe, expect, it } from 'bun:test';
import { contrastRatio, oklchToRgb, parseHex, rgbToOklch, toHex, type Rgb } from './color';
import { AA, generateTheme, polarityOf, tokensToCss, type TokenName } from './generate';

/** Today's hand-authored Linear values, converted from the oklch in tokens.css. */
const ok = (l: number, c: number, h: number): string => toHex(oklchToRgb([l, c, h]));

const LINEAR_DARK: Partial<Record<TokenName, string>> = {
  surface: ok(0.145, 0.004, 265),
  'surface-inset': ok(0.12, 0.004, 265),
  'surface-elevated': ok(0.19, 0.005, 265),
  'surface-variant': ok(0.19, 0.005, 265),
  'surface-hover': ok(0.255, 0.006, 265),
  'surface-bright': ok(0.32, 0.007, 265),
  border: ok(0.255, 0.006, 265),
  'border-bright': ok(0.32, 0.007, 265),
  'outline-variant': ok(0.48, 0.008, 265),
  'text-tertiary': ok(0.636, 0.008, 265),
  'text-secondary': ok(0.78, 0.006, 265),
  'text-primary': ok(0.97, 0.002, 265),
};

const LINEAR_LIGHT: Partial<Record<TokenName, string>> = {
  surface: ok(1, 0, 0),
  'surface-inset': ok(0.958, 0.004, 265),
  'surface-elevated': ok(0.995, 0.001, 265),
  'surface-variant': ok(0.965, 0.003, 265),
  'surface-hover': ok(0.945, 0.005, 265),
  'surface-bright': ok(0.9, 0.005, 265),
  border: ok(0.915, 0.004, 265),
  'border-bright': ok(0.78, 0.006, 265),
  'outline-variant': ok(0.62, 0.008, 265),
  'text-tertiary': ok(0.529, 0.008, 265),
  'text-secondary': ok(0.48, 0.008, 265),
  'text-primary': ok(0.22, 0.006, 265),
};

const lightnessOf = (hex: string): number => rgbToOklch(parseHex(hex) as Rgb)[0];

/** 0.01 in oklch L is roughly the just-noticeable step. Stay well inside it. */
const JND = 0.01;

describe('reproduces the ramp it replaces', () => {
  it.each([
    ['dark', '#090A0C', LINEAR_DARK],
    ['light', '#FFFFFF', LINEAR_LIGHT],
  ] as const)('matches Linear %s within a just-noticeable step', (_name, background, expected) => {
    const got = generateTheme({ accent: '#5E6AD2', background, contrast: 95 });
    for (const [token, want] of Object.entries(expected)) {
      const drift = Math.abs(lightnessOf(got[token as TokenName]) - lightnessOf(want));
      expect(drift).toBeLessThan(JND);
    }
  });
});

describe('polarity is derived from the background', () => {
  it.each([
    ['#FFFFFF', 'light'],
    ['#F4F5F7', 'light'],
    ['#090A0C', 'dark'],
    ['#191A22', 'dark'],
    ['#1A1A1A', 'dark'],
  ] as const)('reads %s as %s', (background, want) => {
    expect(polarityOf(background)).toBe(want);
  });

  // No stored mode means nothing can disagree with the background about which
  // way the ladder runs.
  it('runs the ladder away from the background in both polarities', () => {
    const dark = generateTheme({ accent: '#5E6AD2', background: '#090A0C', contrast: 95 });
    expect(lightnessOf(dark['text-primary'])).toBeGreaterThan(lightnessOf(dark.surface));
    const light = generateTheme({ accent: '#5E6AD2', background: '#FFFFFF', contrast: 95 });
    expect(lightnessOf(light['text-primary'])).toBeLessThan(lightnessOf(light.surface));
  });
});

describe('text is floored at AA regardless of contrast', () => {
  // The measurement that forced the floor: without it, contrast 30 puts
  // primary text at 2.67:1.
  it.each([0, 15, 30, 45, 60, 75, 95, 100])('clears AA at contrast %i', contrast => {
    const t = generateTheme({ accent: '#575AC6', background: '#191A22', contrast });
    const surface = parseHex(t.surface) as Rgb;
    for (const name of ['text-primary', 'text-secondary', 'text-tertiary'] as const) {
      expect(contrastRatio(parseHex(t[name]) as Rgb, surface)).toBeGreaterThanOrEqual(AA - 0.01);
    }
  });

  // The floor is a rescue, not a participant. At the shipped contrast the
  // ladder already clears AA by a wide margin, so the lift must be a no-op —
  // otherwise it would be quietly repainting the default themes.
  it('does not engage at the shipped contrast', () => {
    const t = generateTheme({ accent: '#5E6AD2', background: '#090A0C', contrast: 95 });
    const surface = parseHex(t.surface) as Rgb;
    expect(contrastRatio(parseHex(t['text-primary']) as Rgb, surface)).toBeGreaterThan(15);
    const drift = Math.abs(
      lightnessOf(t['text-primary']) - lightnessOf(LINEAR_DARK['text-primary'] as string)
    );
    expect(drift).toBeLessThan(JND);
  });
});

describe('contrast shapes the surface ladder', () => {
  it('spreads surfaces further apart as contrast rises', () => {
    const spread = (contrast: number): number =>
      Math.abs(
        lightnessOf(
          generateTheme({ accent: '#575AC6', background: '#191A22', contrast })['surface-bright']
        ) -
          lightnessOf(generateTheme({ accent: '#575AC6', background: '#191A22', contrast }).surface)
      );
    expect(spread(95)).toBeGreaterThan(spread(60));
    expect(spread(60)).toBeGreaterThan(spread(30));
  });
});

describe('the accent is clamped, never rejected', () => {
  it('keeps the fill exactly as picked', () => {
    expect(generateTheme({ accent: '#FFEE00', background: '#FFFFFF', contrast: 95 }).accent).toBe(
      '#FFEE00'
    );
  });

  it.each([
    ['#333333', '#222222', 95],
    ['#FFEE00', '#FFFFFF', 95],
    ['#8B0000', '#120008', 40],
    ['#5E6AD2', '#090A0C', 95],
  ] as const)('makes %s on %s readable as text', (accent, background, contrast) => {
    const t = generateTheme({ accent, background, contrast });
    const against = parseHex(t['surface-hover']) as Rgb;
    expect(contrastRatio(parseHex(t['accent-bright']) as Rgb, against)).toBeGreaterThanOrEqual(
      AA - 0.01
    );
  });

  // The specific lift that started this: Linear's own indigo is a fill colour,
  // and using it as text is the bug the generator exists to prevent.
  it('lifts the raw indigo, which fails AA, into one that passes', () => {
    const t = generateTheme({ accent: '#5E6AD2', background: '#090A0C', contrast: 95 });
    const against = parseHex(t['surface-hover']) as Rgb;
    expect(contrastRatio([0x5e, 0x6a, 0xd2], against)).toBeLessThan(AA);
    expect(contrastRatio(parseHex(t['accent-bright']) as Rgb, against)).toBeGreaterThanOrEqual(AA);
  });
});

describe('malformed input renders something', () => {
  // A colour field mid-keystroke must not crash the app.
  it.each(['', '#', '#5E6', 'blue', '#GGGGGG'])('falls back for %p', bad => {
    const t = generateTheme({ accent: bad, background: bad, contrast: 95 });
    for (const value of Object.values(t)) expect(value).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('clamps contrast outside 0-100', () => {
    const low = generateTheme({ accent: '#5E6AD2', background: '#090A0C', contrast: -50 });
    const high = generateTheme({ accent: '#5E6AD2', background: '#090A0C', contrast: 500 });
    expect(low.surface).toBe(
      generateTheme({ accent: '#5E6AD2', background: '#090A0C', contrast: 0 }).surface
    );
    expect(high.surface).toBe(
      generateTheme({ accent: '#5E6AD2', background: '#090A0C', contrast: 100 }).surface
    );
  });
});

describe('tokensToCss', () => {
  it('emits every token as a custom property', () => {
    const css = tokensToCss(
      generateTheme({ accent: '#5E6AD2', background: '#090A0C', contrast: 95 })
    );
    expect(css).toContain('--surface-hover: #');
    expect(css).toContain('--accent-bright: #');
    expect(css.split('\n')).toHaveLength(16);
  });
});
