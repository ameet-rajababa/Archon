/**
 * CodeMirror language modes, loaded per file type.
 *
 * DYNAMIC IMPORT IS THE POINT. The eight grammars together are ~140 kB gzip —
 * more than the editor itself — and a session that only ever opens Markdown
 * should not pay for Rust. Each mode arrives when a file of that type is first
 * opened, and the browser caches it from there.
 *
 * An unknown extension resolves to no extensions, which renders as plain text
 * rather than under a wrong grammar.
 */
import type { Extension } from '@codemirror/state';

type Loader = () => Promise<Extension>;

const LOADERS: Readonly<Record<string, Loader>> = {
  ts: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true }),
  tsx: async () =>
    (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true }),
  js: async () => (await import('@codemirror/lang-javascript')).javascript(),
  jsx: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }),
  mjs: async () => (await import('@codemirror/lang-javascript')).javascript(),
  json: async () => (await import('@codemirror/lang-json')).json(),
  md: async () => (await import('@codemirror/lang-markdown')).markdown(),
  yml: async () => (await import('@codemirror/lang-yaml')).yaml(),
  yaml: async () => (await import('@codemirror/lang-yaml')).yaml(),
  py: async () => (await import('@codemirror/lang-python')).python(),
  css: async () => (await import('@codemirror/lang-css')).css(),
  html: async () => (await import('@codemirror/lang-html')).html(),
  rs: async () => (await import('@codemirror/lang-rust')).rust(),
  sql: async () => (await import('@codemirror/lang-sql')).sql(),
};

/** The extension of a path, lowercased. Empty for a dotfile or an extensionless name. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** True when this build has a grammar for the path — no request is made to find out. */
export function hasLanguage(path: string): boolean {
  return extensionOf(path) in LOADERS;
}

export async function loadLanguage(path: string): Promise<Extension[]> {
  const loader = LOADERS[extensionOf(path)];
  if (loader === undefined) return [];
  try {
    return [await loader()];
  } catch {
    // A chunk that will not load must not take the viewer down with it: the
    // file still reads perfectly well without colour.
    return [];
  }
}
