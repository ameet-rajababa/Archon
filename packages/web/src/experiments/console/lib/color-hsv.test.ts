import { describe, expect, test } from 'bun:test';
import { hexToHsv, hsvToHex, isHexColor } from './color-hsv';

describe('hsvToHex', () => {
  test('the primaries land on their exact hex', () => {
    expect(hsvToHex(0, 1, 1)).toBe('#ff0000');
    expect(hsvToHex(120, 1, 1)).toBe('#00ff00');
    expect(hsvToHex(240, 1, 1)).toBe('#0000ff');
  });
  test('value 0 is black and saturation 0 is a grey, whatever the hue', () => {
    expect(hsvToHex(200, 1, 0)).toBe('#000000');
    expect(hsvToHex(200, 0, 1)).toBe('#ffffff');
    expect(hsvToHex(340, 0, 0.5)).toBe('#808080');
  });
  test('hue wraps rather than clipping, because the rail is a loop', () => {
    expect(hsvToHex(360, 1, 1)).toBe(hsvToHex(0, 1, 1));
    expect(hsvToHex(-120, 1, 1)).toBe(hsvToHex(240, 1, 1));
  });
});

describe('hexToHsv', () => {
  test('round-trips a color the picker could produce', () => {
    const hsv = hexToHsv('#3b82f6');
    expect(hsv).not.toBeNull();
    expect(hsvToHex(hsv?.h ?? 0, hsv?.s ?? 0, hsv?.v ?? 0)).toBe('#3b82f6');
  });
  test('accepts a bare or upper-case value, because people paste both', () => {
    expect(hexToHsv('3B82F6')).toEqual(hexToHsv('#3b82f6'));
    expect(hexToHsv('  #3B82F6 ')).toEqual(hexToHsv('#3b82f6'));
  });
  test('a preset is not a hex — that is how the two are told apart', () => {
    expect(hexToHsv('oklch(0.58 0.17 275)')).toBeNull();
    expect(hexToHsv('indigo')).toBeNull();
    // Shorthand is rejected on purpose: the picker never writes it, and
    // accepting it would mean two spellings of one stored value.
    expect(hexToHsv('#abc')).toBeNull();
    expect(hexToHsv('')).toBeNull();
  });
});

describe('isHexColor', () => {
  test('agrees with hexToHsv on what counts as a literal color', () => {
    for (const v of ['#3b82f6', '#FFFFFF', 'oklch(0.7 0.14 160)', 'green', '#abc', '']) {
      expect(isHexColor(v)).toBe(hexToHsv(v) !== null && v.trim().startsWith('#'));
    }
  });
});
