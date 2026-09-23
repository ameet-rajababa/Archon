import { describe, test, expect } from 'bun:test';
import { extensionOf, hasLanguage, loadLanguage } from './code-language';

describe('extensionOf', () => {
  test('reads the extension, and a dotfile has none', () => {
    expect(extensionOf('src/index.ts')).toBe('ts');
    expect(extensionOf('a/b/NOTES.MD')).toBe('md');
    // A leading dot is not an extension: `.gitignore` is a name, not a
    // gitignore-flavoured file.
    expect(extensionOf('.gitignore')).toBe('');
    expect(extensionOf('Makefile')).toBe('');
  });
});

describe('hasLanguage', () => {
  test('answers without loading anything', () => {
    expect(hasLanguage('a.ts')).toBe(true);
    expect(hasLanguage('a.rs')).toBe(true);
    expect(hasLanguage('a.xyz')).toBe(false);
    expect(hasLanguage('Makefile')).toBe(false);
  });
});

describe('loadLanguage', () => {
  test('loads a grammar for a known extension', async () => {
    expect(await loadLanguage('src/index.ts')).toHaveLength(1);
    expect(await loadLanguage('README.md')).toHaveLength(1);
  });

  test('an unknown extension is plain text, not a wrong grammar', async () => {
    // No import is attempted at all, so this cannot fail and cannot mislabel.
    expect(await loadLanguage('data.xyz')).toEqual([]);
    expect(await loadLanguage('LICENSE')).toEqual([]);
  });
});
