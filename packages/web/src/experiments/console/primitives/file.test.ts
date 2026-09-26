import { describe, test, expect } from 'bun:test';
import {
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
  admitFiles,
  dragHasFiles,
  formatBytes,
  imagesFromClipboard,
  isAcceptedFileType,
} from './file';

const file = (name: string, type = ''): File => new File(['x'], name, { type });

describe('isAcceptedFileType', () => {
  test('accepts by MIME — text/*, image/*, pdf, json', () => {
    expect(isAcceptedFileType(file('a', 'text/plain'))).toBe(true);
    expect(isAcceptedFileType(file('a', 'image/png'))).toBe(true);
    expect(isAcceptedFileType(file('a', 'application/pdf'))).toBe(true);
    expect(isAcceptedFileType(file('a', 'application/json'))).toBe(true);
  });

  test('accepts by extension when the MIME type is empty (code/config files)', () => {
    expect(isAcceptedFileType(file('main.py'))).toBe(true);
    expect(isAcceptedFileType(file('schema.sql'))).toBe(true);
    expect(isAcceptedFileType(file('Config.YAML'))).toBe(true); // case-insensitive
  });

  test('rejects an unknown extension with an empty MIME', () => {
    expect(isAcceptedFileType(file('archive.zip'))).toBe(false);
    expect(isAcceptedFileType(file('binary.exe'))).toBe(false);
  });

  test('rejects no-extension files and dotfiles', () => {
    expect(isAcceptedFileType(file('Makefile'))).toBe(false);
    expect(isAcceptedFileType(file('.gitignore'))).toBe(false);
  });
});

describe('formatBytes', () => {
  test('formats B / KB / MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
  });
});

describe('dragHasFiles', () => {
  test('true when the drag carries files', () => {
    expect(dragHasFiles(['Files'])).toBe(true);
    // A desktop file drag commonly advertises several types alongside Files.
    expect(dragHasFiles(['application/x-moz-file', 'Files'])).toBe(true);
  });

  test('false for a text drag — selecting inside the textarea and dragging it', () => {
    expect(dragHasFiles(['text/plain'])).toBe(false);
    expect(dragHasFiles(['text/plain', 'text/html'])).toBe(false);
  });

  test('false for a drag that advertises nothing', () => {
    expect(dragHasFiles([])).toBe(false);
  });

  test("reads array-likes, since Safari's types is a DOMStringList", () => {
    const domStringList = { length: 1, 0: 'Files' } as unknown as DataTransfer['types'];
    expect(dragHasFiles(domStringList)).toBe(true);
  });
});

const clipboardItem = (type: string, asFile: File | null): DataTransferItem =>
  ({
    type,
    kind: asFile === null ? 'string' : 'file',
    getAsFile: () => asFile,
  }) as DataTransferItem;

const itemList = (...items: DataTransferItem[]): DataTransferItemList => {
  // DataTransferItemList is array-like, not an array: indexed keys plus length.
  const list: Record<string, unknown> = { length: items.length };
  items.forEach((item, i) => (list[String(i)] = item));
  return list as unknown as DataTransferItemList;
};

describe('imagesFromClipboard', () => {
  test('takes the image off a pasted screenshot', () => {
    const png = new File(['x'], 'image.png', { type: 'image/png' });
    expect(imagesFromClipboard(itemList(clipboardItem('image/png', png)))).toEqual([png]);
  });

  test('ignores a plain text copy, so ordinary pasting is untouched', () => {
    const items = itemList(clipboardItem('text/plain', null), clipboardItem('text/html', null));
    expect(imagesFromClipboard(items)).toEqual([]);
  });

  test('takes only the image when a web-page copy carries text alongside it', () => {
    const jpg = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const items = itemList(
      clipboardItem('text/html', null),
      clipboardItem('image/jpeg', jpg),
      clipboardItem('text/plain', null)
    );
    expect(imagesFromClipboard(items)).toEqual([jpg]);
  });

  test('skips an image item that yields no file', () => {
    expect(imagesFromClipboard(itemList(clipboardItem('image/png', null)))).toEqual([]);
  });

  test('returns nothing for an empty clipboard', () => {
    expect(imagesFromClipboard(itemList())).toEqual([]);
  });
});

describe('admitFiles', () => {
  const sized = (name: string, bytes: number): File =>
    new File([new Uint8Array(bytes)], name, { type: 'text/plain' });

  test('keeps what was already attached and appends the admitted files', () => {
    const kept = [file('a.md', 'text/markdown')];
    const admitted = admitFiles(kept, [file('b.md', 'text/markdown')]);
    expect(admitted.files.map(f => f.name)).toEqual(['a.md', 'b.md']);
    expect(admitted.error).toBeNull();
    expect(kept).toHaveLength(1); // the input list is not mutated
  });

  test('refuses past the file-count limit', () => {
    const kept = Array.from({ length: MAX_FILES }, (_, i) =>
      file(`k${String(i)}.md`, 'text/plain')
    );
    const admitted = admitFiles(kept, [file('one-too-many.md', 'text/plain')]);
    expect(admitted.files).toHaveLength(MAX_FILES);
    expect(admitted.error).toBe(
      `Skipped 1 file(s) — one-too-many.md: over the ${String(MAX_FILES)}-file limit`
    );
  });

  test('refuses an oversized file', () => {
    const admitted = admitFiles([], [sized('huge.txt', MAX_FILE_BYTES + 1)]);
    expect(admitted.files).toEqual([]);
    expect(admitted.error).toBe(
      `Skipped 1 file(s) — huge.txt: larger than ${String(MAX_FILE_MB)} MB`
    );
  });

  test('refuses an unsupported type', () => {
    const admitted = admitFiles(
      [],
      [new File(['x'], 'thing.exe', { type: 'application/x-msdownload' })]
    );
    expect(admitted.files).toEqual([]);
    expect(admitted.error).toBe('Skipped 1 file(s) — thing.exe: unsupported type');
  });

  // A mixed pick that reported only the last refusal would leave the user
  // guessing which of the others made it.
  test('names every refusal, and still keeps the good files', () => {
    const admitted = admitFiles(
      [],
      [
        file('good.md', 'text/markdown'),
        sized('huge.txt', MAX_FILE_BYTES + 1),
        new File(['x'], 'thing.exe', { type: 'application/x-msdownload' }),
      ]
    );
    expect(admitted.files.map(f => f.name)).toEqual(['good.md']);
    expect(admitted.error).toContain('Skipped 2 file(s)');
    expect(admitted.error).toContain('huge.txt: larger than');
    expect(admitted.error).toContain('thing.exe: unsupported type');
  });
});
