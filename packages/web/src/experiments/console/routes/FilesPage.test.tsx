import { describe, test, expect, afterEach } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { FilesPage } from './FilesPage';
import { invalidate, keysStartingWith, set } from '../store/cache';
import { K } from '../store/keys';
import { toFileEntry, type FileEntry } from '../primitives/file-entry';

const PROJECT = 'project-1';

const entries = (
  dir: string,
  raw: { name: string; kind: string; size: number | null }[]
): FileEntry[] => raw.map(r => toFileEntry(r, dir));

function render(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/console/p/${PROJECT}/files`]}>
      <Routes>
        <Route path="/console/p/:projectId/files" element={<FilesPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('FilesPage', () => {
  afterEach(() => {
    invalidate('files:');
    invalidate('file:');
  });

  test('renders the root listing, and only the root', () => {
    // The lazy invariant, proved by request count rather than by reading the
    // code: a collapsed directory does not mount, so its cache key is never
    // asked for. One seeded key in, one key touched.
    set(
      K.files(PROJECT, ''),
      entries('', [
        { name: 'src', kind: 'dir', size: null },
        { name: 'README.md', kind: 'file', size: 8 },
      ])
    );

    const html = render();

    expect(html).toContain('README.md');
    expect(html).toContain('src');
    expect(keysStartingWith('files:')).toEqual([K.files(PROJECT, '')]);
  });

  test('a file size is shown and a directory carries none', () => {
    set(
      K.files(PROJECT, ''),
      entries('', [
        { name: 'src', kind: 'dir', size: null },
        { name: 'README.md', kind: 'file', size: 2048 },
      ])
    );

    const html = render();
    expect(html).toContain('2 KB');
  });

  test('nothing is open until a file is picked', () => {
    set(K.files(PROJECT, ''), entries('', [{ name: 'README.md', kind: 'file', size: 8 }]));

    const html = render();
    expect(html).toContain('No file selected');
    expect(html).toContain('Nothing open');
    // No file content was requested for a page where nothing is selected.
    expect(keysStartingWith('file:')).toEqual([]);
  });

  test('an entry of an unknown kind renders inert rather than openable', () => {
    set(K.files(PROJECT, ''), entries('', [{ name: 'a.sock', kind: 'fifo', size: null }]));

    const html = render();
    expect(html).toContain('a.sock');
    // `other` cannot be opened — the button is disabled rather than leading to
    // a read the server will refuse.
    expect(html).toContain('disabled=""');
  });

  test('an empty project root says so instead of rendering nothing', () => {
    set(K.files(PROJECT, ''), []);
    expect(render()).toContain('Empty');
  });
});
