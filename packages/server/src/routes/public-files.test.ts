import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import { removeTempTree } from '@archon/paths/test-utils';
import { mkdir, writeFile } from 'fs/promises';
import { mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { registerPublicFiles } from './public-files';

/**
 * Exercises the real registration, not a parallel app built to resemble it —
 * the claim being protected is that THIS route refuses to escape its root, and
 * a lookalike would only prove something about serveStatic.
 */
let base = '';
let root = '';
let app: OpenAPIHono;

beforeAll(async () => {
  // The served root is a SUBDIRECTORY of the temp base, so the planted secret
  // can sit exactly one level above it under a predictable name. With the root
  // itself as the temp dir, `/files/../archon-secret.txt` would name a file
  // that never existed and the assertion would pass without proving anything.
  base = await mkdtemp(join(tmpdir(), 'archon-public-'));
  root = join(base, 'public');
  await mkdir(join(root, 'archon', 'web-123'), { recursive: true });
  await writeFile(join(root, 'archon', 'web-123', 'shot.png'), 'PNGBYTES');
  // Reaching this is the whole failure this route could have. A real planted
  // target, not /etc/passwd, which may not be readable anyway.
  await writeFile(join(base, 'archon-secret.txt'), 'TOPSECRET');
  app = new OpenAPIHono();
  await registerPublicFiles(app, root);
  // The SPA catch-all the real server registers after this one. Present so the
  // test can tell "the route declined" from "the route was never reached".
  app.get('*', c => c.text('SPA', 200));
});

afterAll(async () => {
  await removeTempTree(base);
});

// `app.request` is typed `Response | Promise<Response>`; `async` narrows the
// union to the awaited form every caller here already treats it as.
const get = async (path: string): Promise<Response> => app.request(path);

describe('registerPublicFiles', () => {
  test('serves a published file', async () => {
    const res = await get('/files/archon/web-123/shot.png');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('PNGBYTES');
  });

  test('does not cache — a replaced file keeps its name', async () => {
    const res = await get('/files/archon/web-123/shot.png');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });

  describe('refuses to escape its root', () => {
    // Each of these resolves above `root` if the path is joined naively.
    test.each([
      '/files/../archon-secret.txt',
      '/files/../../etc/passwd',
      '/files/archon/../../archon-secret.txt',
      '/files/%2e%2e/%2e%2e/etc/passwd',
      '/files/..%2f..%2fetc%2fpasswd',
      '/files/./../../etc/passwd',
    ])('%s does not return file contents', async path => {
      const res = await get(path);
      const body = await res.text();
      expect(body).not.toContain('TOPSECRET');
      expect(body).not.toContain('root:');
    });

    test('a traversal that misses falls through rather than serving anything', async () => {
      const res = await get('/files/../../etc/passwd');
      // Either the static handler declines (and the catch-all answers) or it
      // 404s. What must never happen is a 200 carrying the file.
      expect(await res.text()).not.toContain('root:');
    });
  });

  // Proves the assertions above can FAIL. Pointed one level up, the same
  // request that is refused by the real root returns the secret — so a green
  // traversal suite means the root is pinned, not that the target was absent.
  test('the traversal assertions are capable of failing', async () => {
    const loose = new OpenAPIHono();
    await registerPublicFiles(loose, base);
    const res = await loose.request('/files/archon-secret.txt');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('TOPSECRET');
  });

  test('a missing file is not answered with the SPA shell as a 200 image', async () => {
    const res = await get('/files/archon/web-123/nope.png');
    // Falling through to the catch-all is acceptable; serving HTML that claims
    // to be the missing PNG is not.
    expect(await res.text()).not.toBe('PNGBYTES');
  });

  test('leaves routes outside /files alone', async () => {
    const res = await get('/console');
    expect(await res.text()).toBe('SPA');
  });
});
