/**
 * The named themes, as triples.
 *
 * A preset is not a special kind of theme — it is a `ThemeInput` with a name.
 * The same generator produces these and a user's custom one, which is what
 * keeps "Custom" from being a second, weaker code path.
 *
 * `system` is not here on purpose. It is a RESOLVER, not a palette: it picks
 * between `LIGHT_PRESET` and `DARK_PRESET` from the OS preference, so it must
 * name presets rather than be one.
 */
import type { ThemeInput } from './generate';

export interface Preset extends ThemeInput {
  id: PresetId;
  label: string;
}

export type PresetId = 'pure-light' | 'light' | 'dark' | 'classic-dark' | 'magic-blue';

/**
 * `dark` reproduces the Linear dark theme this replaces, so the default
 * install looks identical after the change — `generate.test.ts` holds it there.
 *
 * `magic-blue` is measured: accent #575AC6 on background #191A22 at contrast
 * 95. The remaining three are chosen, not measured.
 */
export const PRESETS: readonly Preset[] = [
  { id: 'pure-light', label: 'Pure Light', accent: '#5E6AD2', background: '#FFFFFF', contrast: 95 },
  { id: 'light', label: 'Light', accent: '#5E6AD2', background: '#F4F5F7', contrast: 92 },
  { id: 'dark', label: 'Dark', accent: '#5E6AD2', background: '#090A0C', contrast: 95 },
  {
    id: 'classic-dark',
    label: 'Classic Dark',
    accent: '#5E6AD2',
    background: '#1A1A1A',
    contrast: 90,
  },
  { id: 'magic-blue', label: 'Magic Blue', accent: '#575AC6', background: '#191A22', contrast: 95 },
];

/** What `system` resolves to. Named so the pairing is stated, not inferred. */
export const LIGHT_PRESET: PresetId = 'light';
export const DARK_PRESET: PresetId = 'dark';

export function presetById(id: string): Preset | undefined {
  return PRESETS.find(p => p.id === id);
}
