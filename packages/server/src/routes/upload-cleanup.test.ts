import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { cleanupUploads } from './upload-cleanup';

let root: string;
let uploadDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'upload-cleanup-'));
  uploadDir = join(root, 'conversation-1');
  await mkdir(uploadDir, { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(name: string): Promise<{ path: string }> {
  const path = join(uploadDir, name);
  await writeFile(path, 'x');
  return { path };
}

const exists = async (dir: string): Promise<string[] | null> => readdir(dir).catch(() => null);

describe('cleanupUploads', () => {
  test('removes its own files and then the directory', async () => {
    const files = [await write('a.png'), await write('b.png')];
    const warnings: unknown[] = [];
    await cleanupUploads(files, uploadDir, e => warnings.push(e));
    expect(await exists(uploadDir)).toBeNull();
    expect(warnings).toEqual([]);
  });

  test('leaves a file that arrived for a QUEUED message, and keeps the directory', async () => {
    // The actual bug: the directory is per conversation, so a message queued
    // behind this one has already written into it. A recursive delete took the
    // screenshot the next turn was about to read.
    const mine = [await write('mine.png')];
    await write('queued-behind-me.png');
    const warnings: unknown[] = [];

    await cleanupUploads(mine, uploadDir, e => warnings.push(e));

    expect(await exists(uploadDir)).toEqual(['queued-behind-me.png']);
    // ENOTEMPTY is the expected outcome here, not something to report.
    expect(warnings).toEqual([]);
  });

  test('a file already gone is not worth a warning', async () => {
    const warnings: unknown[] = [];
    await cleanupUploads([{ path: join(uploadDir, 'never-existed.png') }], uploadDir, e =>
      warnings.push(e)
    );
    expect(warnings).toEqual([]);
  });

  test('a directory already gone is not worth a warning', async () => {
    await rm(uploadDir, { recursive: true, force: true });
    const warnings: unknown[] = [];
    await cleanupUploads([], uploadDir, e => warnings.push(e));
    expect(warnings).toEqual([]);
  });

  test('reports a real failure instead of throwing', async () => {
    // A path whose parent is a FILE gives ENOTDIR — neither ENOENT nor
    // ENOTEMPTY, so it must be surfaced.
    const notADir = join(root, 'plain-file');
    await writeFile(notADir, 'x');
    const warnings: NodeJS.ErrnoException[] = [];
    await cleanupUploads([], join(notADir, 'nested'), e => {
      warnings.push(e);
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('ENOTDIR');
  });
});
