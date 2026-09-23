import { describe, test, expect } from 'bun:test';
import {
  ancestors,
  formatBytes,
  joinPath,
  languageFor,
  hasPreview,
  isHtmlPath,
  isImagePath,
  isMarkdownPath,
  parentPath,
  toFileEntry,
} from './file-entry';

describe('joinPath', () => {
  test('the root has no separator', () => {
    // A leading slash would address the server's filesystem root rather than
    // the project's, and the API refuses it — so this is a correctness rule,
    // not cosmetics.
    expect(joinPath('', 'README.md')).toBe('README.md');
    expect(joinPath('src', 'index.ts')).toBe('src/index.ts');
  });
});

describe('parentPath', () => {
  test('walks up, and stops at the root', () => {
    expect(parentPath('src/lib/x.ts')).toBe('src/lib');
    expect(parentPath('src')).toBe('');
    expect(parentPath('')).toBeNull();
  });
});

describe('ancestors', () => {
  test('lists every directory that must be open to show a path', () => {
    expect(ancestors('src/lib/x.ts')).toEqual(['', 'src', 'src/lib']);
    expect(ancestors('README.md')).toEqual(['']);
    expect(ancestors('')).toEqual([]);
  });
});

describe('toFileEntry', () => {
  test('carries the path its directory gives it', () => {
    const entry = toFileEntry({ name: 'index.ts', kind: 'file', size: 20 }, 'src');
    expect(entry.path).toBe('src/index.ts');
    expect(entry.kind).toBe('file');
  });

  test('an unrecognised kind reads as other, not as a file', () => {
    // A newer server could name a kind this build does not know. Guessing
    // 'file' would make it openable and fail on read.
    const entry = toFileEntry({ name: 'sock', kind: 'fifo', size: null }, '');
    expect(entry.kind).toBe('other');
  });
});

describe('languageFor', () => {
  test('maps known extensions and stays silent on the rest', () => {
    expect(languageFor('src/index.ts')).toBe('typescript');
    expect(languageFor('a/b/notes.md')).toBe('markdown');
    // Unknown extension renders as plain text rather than under a wrong grammar.
    expect(languageFor('data.xyz')).toBe('');
    // A dotfile is not an extension.
    expect(languageFor('.gitignore')).toBe('');
    expect(languageFor('Makefile')).toBe('');
  });
});

describe('formatBytes', () => {
  test('reads at a glance, and says nothing for a directory', () => {
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('file kinds the viewer treats specially', () => {
  test('raster images are images', () => {
    expect(isImagePath('a/logo.png')).toBe(true);
    expect(isImagePath('shot.JPEG')).toBe(true);
    expect(isImagePath('notes.md')).toBe(false);
  });

  test('SVG is NOT an image here', () => {
    // It is a script-bearing document. Both this and the server's raw route
    // leave it out, so it is read as source instead of rendered.
    expect(isImagePath('icon.svg')).toBe(false);
  });

  test('markdown and html have a preview, source files do not', () => {
    expect(isMarkdownPath('README.md')).toBe(true);
    expect(isHtmlPath('page.html')).toBe(true);
    expect(isHtmlPath('page.htm')).toBe(true);
    expect(hasPreview('README.md')).toBe(true);
    expect(hasPreview('page.html')).toBe(true);
    expect(hasPreview('index.ts')).toBe(false);
    expect(hasPreview('logo.png')).toBe(false);
  });
});
