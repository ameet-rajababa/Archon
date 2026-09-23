import { requestJson } from '../lib/http';
import { toFileEntry, type FileEntry } from '../primitives/file-entry';

interface RawListing {
  path: string;
  entries: { name: string; kind: string; size: number | null }[];
}

interface RawFile {
  path: string;
  content: string;
  size: number;
}

export interface FileContent {
  path: string;
  content: string;
  size: number;
}

/**
 * One directory of a project's checkout. `path` is relative to the project
 * root; the empty string is the root itself.
 */
export async function listFiles(projectId: string, path: string): Promise<FileEntry[]> {
  const res = await requestJson<RawListing>(
    `/api/codebases/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(path)}`
  );
  return res.entries.map(entry => toFileEntry(entry, res.path));
}

/** One text file. The server refuses binaries and anything over its size ceiling. */
export async function readFileContent(projectId: string, path: string): Promise<FileContent> {
  return requestJson<RawFile>(
    `/api/codebases/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}`
  );
}
