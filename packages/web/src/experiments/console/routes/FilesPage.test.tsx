import { describe, test, expect, afterEach } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { FilesPage } from './FilesPage';
import { invalidate } from '../store/cache';

const PROJECT = 'project-1';

function render(search: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/console/p/${PROJECT}/files${search}`]}>
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

  test('the open file comes from the URL, so it is linkable', () => {
    expect(render('?file=README.md')).toContain('README.md');
    expect(render('')).toContain('No file selected');
  });

  test('an image renders from the raw route, not the text route', () => {
    // The text route refuses binaries, correctly. Asking it anyway would paint
    // a refusal over a file the viewer can show.
    const html = render('?file=docs/logo.png');
    expect(html).toContain('/api/codebases/project-1/raw?path=docs%2Flogo.png');
    expect(html).toContain('<img');
  });

  test('markdown and html offer a preview toggle; a source file does not', () => {
    expect(render('?file=README.md')).toContain('Source');
    expect(render('?file=page.html')).toContain('Source');
    expect(render('?file=src/index.ts')).not.toContain('>Source<');
  });

  test('an image offers no save or preview controls', () => {
    const html = render('?file=logo.png');
    expect(html).not.toContain('>Source<');
  });
});
