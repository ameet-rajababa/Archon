/**
 * One entry in a project's checkout, normalised from the server's listing.
 *
 * Paths here are always RELATIVE to the project root and always use `/`. The
 * root itself is the empty string, which is why `join` below special-cases it:
 * a leading slash would address the server's filesystem root rather than the
 * project's, and the API would rightly refuse it.
 */

export type FileKind = 'file' | 'dir' | 'other';

export interface FileEntry {
  /** Name within its directory — never a path. */
  name: string;
  kind: FileKind;
  /** Byte size for regular files, null for everything else. */
  size: number | null;
  /** Path from the project root, which is what both endpoints take. */
  path: string;
}

interface RawFileEntry {
  name: string;
  kind: string;
  size: number | null;
}

/**
 * Anything the server reports that this build does not recognise reads as
 * 'other' — an unknown kind renders as an inert row rather than throwing, and
 * 'other' is already the kind that cannot be opened.
 */
function parseKind(raw: string): FileKind {
  return raw === 'file' || raw === 'dir' ? raw : 'other';
}

/** Join a directory path with a child name. The root is '' and has no separator. */
export function joinPath(dir: string, name: string): string {
  return dir === '' ? name : `${dir}/${name}`;
}

/** The parent of a path, or null at the root. */
export function parentPath(path: string): string | null {
  if (path === '') return null;
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

/** Every ancestor of a path, root first — what a tree must have open to show it. */
export function ancestors(path: string): string[] {
  const out: string[] = [];
  let current = parentPath(path);
  while (current !== null) {
    out.unshift(current);
    current = parentPath(current);
  }
  return out;
}

export function toFileEntry(raw: RawFileEntry, dir: string): FileEntry {
  return {
    name: raw.name,
    kind: parseKind(raw.kind),
    size: raw.size,
    path: joinPath(dir, raw.name),
  };
}

/**
 * Language hint for the viewer's fence, by extension.
 *
 * Deliberately a small map and not a lookup table of every language
 * highlight.js knows: an unknown extension falls back to no language, which
 * renders as plain monospace text rather than as the wrong grammar.
 */
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  css: 'css',
  html: 'html',
  sql: 'sql',
  py: 'python',
  rs: 'rust',
  go: 'go',
  toml: 'toml',
};

export function languageFor(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return LANGUAGE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? '';
}

/** Human byte size. Whole numbers below a megabyte — a file listing is scanned, not audited. */
export function formatBytes(size: number | null): string {
  if (size === null) return '';
  if (size < 1024) return `${String(size)} B`;
  if (size < 1024 * 1024) return `${String(Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
