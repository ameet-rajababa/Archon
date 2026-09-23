import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CUSTOM_DEFAULT,
  DEFAULTS,
  parseAppearance,
  resolveTheme,
  type Appearance,
  type ThemeChoice,
} from './appearance';
import { polarityOf } from './generate';
import { DARK_PRESET, LIGHT_PRESET, PRESETS } from './presets';

const base = (patch: Partial<Appearance> = {}): Appearance => ({ ...DEFAULTS, ...patch });

describe('parseAppearance', () => {
  it('falls back for absent or unparseable storage', () => {
    expect(parseAppearance(null)).toEqual(DEFAULTS);
    expect(parseAppearance(undefined)).toEqual(DEFAULTS);
    expect(parseAppearance('not json')).toEqual(DEFAULTS);
    expect(parseAppearance('"a string"')).toEqual(DEFAULTS);
    expect(parseAppearance('null')).toEqual(DEFAULTS);
  });

  it('accepts every shipped theme id', () => {
    for (const choice of [...PRESETS.map(p => p.id), 'system', 'custom'] as ThemeChoice[]) {
      expect(parseAppearance(JSON.stringify({ theme: choice })).theme).toBe(choice);
    }
  });

  it('rejects an unknown theme id', () => {
    expect(parseAppearance(JSON.stringify({ theme: 'chartreuse' })).theme).toBe(DEFAULTS.theme);
  });

  describe('migrating the old {theme, mode} pair', () => {
    // The Archon family is deleted, so its hue cannot survive. Its POLARITY is
    // the part a person notices on reload, and that does survive.
    it.each([
      ['archon', 'light', 'light'],
      ['archon', 'dark', 'dark'],
      ['archon', 'system', 'system'],
      ['linear', 'light', 'light'],
      ['linear', 'dark', 'dark'],
      ['linear', 'system', 'system'],
    ] as const)('maps {%s, %s} to %s', (theme, mode, want) => {
      expect(parseAppearance(JSON.stringify({ theme, mode })).theme).toBe(want);
    });

    it('keeps text and density through the migration', () => {
      const got = parseAppearance(
        JSON.stringify({ theme: 'archon', mode: 'dark', text: 'xl', density: 'compact' })
      );
      expect(got.text).toBe('xl');
      expect(got.density).toBe('compact');
    });
  });

  describe('custom', () => {
    it('round-trips a valid triple', () => {
      const custom = { accent: '#FF0000', background: '#001122', contrast: 40 };
      expect(parseAppearance(JSON.stringify({ theme: 'custom', custom })).custom).toEqual(custom);
    });

    it('falls back per field rather than discarding the whole triple', () => {
      const got = parseAppearance(
        JSON.stringify({ custom: { accent: 'nope', background: '#001122', contrast: 40 } })
      );
      expect(got.custom.accent).toBe(CUSTOM_DEFAULT.accent);
      expect(got.custom.background).toBe('#001122');
    });

    it('clamps a stored contrast outside 0-100', () => {
      const hi = parseAppearance(JSON.stringify({ custom: { contrast: 900 } })).custom.contrast;
      const lo = parseAppearance(JSON.stringify({ custom: { contrast: -900 } })).custom.contrast;
      expect(hi).toBe(100);
      expect(lo).toBe(0);
    });

    it('survives a non-finite contrast', () => {
      const got = parseAppearance('{"custom":{"contrast":null}}').custom.contrast;
      expect(Number.isFinite(got)).toBe(true);
    });
  });
});

describe('resolveTheme', () => {
  it('resolves system from the OS preference', () => {
    expect(resolveTheme(base({ theme: 'system' }), true).id).toBe(DARK_PRESET);
    expect(resolveTheme(base({ theme: 'system' }), false).id).toBe(LIGHT_PRESET);
  });

  it('ignores the OS preference once a theme is chosen', () => {
    for (const prefersDark of [true, false]) {
      expect(resolveTheme(base({ theme: 'pure-light' }), prefersDark).id).toBe('pure-light');
    }
  });

  it('derives polarity from the background, never from a stored mode', () => {
    for (const preset of PRESETS) {
      const got = resolveTheme(base({ theme: preset.id }), false);
      expect(got.polarity).toBe(polarityOf(preset.background));
    }
  });

  it('follows a custom background across the polarity threshold', () => {
    const light = resolveTheme(
      base({ theme: 'custom', custom: { ...CUSTOM_DEFAULT, background: '#FAFAFA' } }),
      true
    );
    const dark = resolveTheme(
      base({ theme: 'custom', custom: { ...CUSTOM_DEFAULT, background: '#0A0A0A' } }),
      false
    );
    expect(light.polarity).toBe('light');
    expect(dark.polarity).toBe('dark');
  });

  it('never resolves to `system`, which has no CSS block', () => {
    for (const prefersDark of [true, false]) {
      expect(resolveTheme(base({ theme: 'system' }), prefersDark).id).not.toBe('system');
    }
  });
});

/**
 * index.html carries a copy of this resolution so the page does not flash
 * before the bundle loads. A comment asking the next person to keep them in
 * step is not a mechanism; this is. It runs the real inline script against the
 * real module and fails when they disagree.
 */
describe('the pre-paint script agrees with appearance.ts', () => {
  const html = readFileSync(join(import.meta.dir, '../../index.html'), 'utf-8');
  const source = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];

  function runInline(stored: unknown, prefersDark: boolean): Record<string, string> {
    const dataset: Record<string, string> = {};
    const sandbox = {
      window: { matchMedia: () => ({ matches: prefersDark }) },
      localStorage: { getItem: () => (stored === null ? null : JSON.stringify(stored)) },
      document: { documentElement: { dataset, style: {} as { background?: string } } },
    };
    new Function('window', 'localStorage', 'document', source as string)(
      sandbox.window,
      sandbox.localStorage,
      sandbox.document
    );
    return dataset;
  }

  it('finds the inline script', () => {
    expect(source).toBeDefined();
  });

  const CASES: { name: string; stored: unknown }[] = [
    { name: 'no stored value', stored: null },
    ...PRESETS.map(p => ({ name: p.id, stored: { theme: p.id } })),
    { name: 'system', stored: { theme: 'system' } },
    {
      name: 'custom dark',
      stored: {
        theme: 'custom',
        custom: { accent: '#FF0000', background: '#101014', contrast: 70 },
      },
    },
    {
      name: 'custom light',
      stored: {
        theme: 'custom',
        custom: { accent: '#FF0000', background: '#FAFAFA', contrast: 70 },
      },
    },
    { name: 'legacy archon dark', stored: { theme: 'archon', mode: 'dark' } },
    { name: 'legacy linear light', stored: { theme: 'linear', mode: 'light' } },
    { name: 'legacy archon system', stored: { theme: 'archon', mode: 'system' } },
    { name: 'unknown theme', stored: { theme: 'chartreuse' } },
  ];

  for (const prefersDark of [true, false]) {
    it.each(CASES)(
      `resolves $name identically (prefersDark=${String(prefersDark)})`,
      ({ stored }) => {
        const inline = runInline(stored, prefersDark);
        const module_ = resolveTheme(
          parseAppearance(stored === null ? null : JSON.stringify(stored)),
          prefersDark
        );
        expect(inline.theme).toBe(module_.id);
        expect(inline.mode).toBe(module_.polarity);
      }
    );
  }
});
