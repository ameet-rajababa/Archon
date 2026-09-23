/**
 * Files v2 - the same two endpoints, rendered by react-arborist and CodeMirror
 * instead of hand-rolled markup.
 *
 * Lives beside v1 rather than replacing it, so the two can be compared on the
 * same checkout with the same data. Reached at /console/p/:projectId/files-v2.
 *
 * EDITABLE. A save carries the `etag` the read returned, so the server can
 * refuse a write against a file that changed underneath it (409) rather than
 * discard whatever wrote it. That refusal is shown, never retried through.
 *
 * EVERY BYTE OF THIS IS LAZY. ConsoleApp mounts it through React.lazy, so the
 * libraries are absent from the initial bundle entirely, and the language
 * grammars arrive per file type (lib/code-language.ts). A session that never
 * opens this tab pays nothing for it.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { Tree, type NodeApi, type NodeRendererProps } from 'react-arborist';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import * as skill from '../skills';
import { EmptyState } from '../components/EmptyState';
import { HttpError } from '../lib/http';
import { loadLanguage } from '../lib/code-language';
import { formatBytes, type FileEntry } from '../primitives/file-entry';

/** A node as react-arborist wants it. `children === undefined` means leaf. */
interface Node {
  id: string;
  name: string;
  kind: FileEntry['kind'];
  size: number | null;
  children?: Node[];
}

/**
 * Stand-in child for a directory nobody has opened yet.
 *
 * Not `[]`: arborist reads an empty array as a genuinely empty folder and
 * renders no twisty, so the directory could never be opened to load it.
 */
const UNREAD: Node[] = [{ id: ' unread', name: 'Loading...', kind: 'other', size: null }];

/** The server's own words for a refusal - "binary file", "too large", "not found". */
function refusalMessage(error: Error): string {
  if (!(error instanceof HttpError)) return error.message;
  try {
    const parsed: unknown = JSON.parse(error.bodySnippet);
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const value = (parsed as { error: unknown }).error;
      if (typeof value === 'string') return value;
    }
  } catch {
    // Not JSON, or cut mid-object by the snippet cap.
  }
  return `Could not read this file (HTTP ${String(error.status)}).`;
}

const THEME = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)' },
    '.cm-gutters': {
      backgroundColor: 'var(--color-surface-inset)',
      color: 'var(--color-text-tertiary)',
      border: 'none',
      borderRight: '1px solid var(--color-border)',
    },
    '.cm-activeLine': { backgroundColor: 'var(--color-surface-elevated)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--color-surface-elevated)' },
  },
  { dark: true }
);

function Row({ node, style }: NodeRendererProps<Node>): ReactElement {
  const entry = node.data;
  return (
    <div
      style={style}
      className={`flex h-full cursor-pointer items-center gap-1.5 pr-2 text-[12.5px] ${
        node.isSelected
          ? 'bg-surface-elevated text-text-primary'
          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
      }`}
      onClick={() => {
        if (entry.kind === 'dir') node.toggle();
      }}
    >
      <span aria-hidden className="w-3 shrink-0 font-mono text-[10px] text-text-tertiary">
        {entry.kind === 'dir' ? (node.isOpen ? 'v' : '>') : ''}
      </span>
      <span className="truncate">{entry.name}</span>
      {entry.kind === 'file' ? (
        <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-text-tertiary">
          {formatBytes(entry.size)}
        </span>
      ) : null}
    </div>
  );
}

export function FilesV2Page(): ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  // The open file lives in the URL, so a file is linkable and survives a
  // reload - the gap v1 has.
  const [params, setParams] = useSearchParams();
  const selected = params.get('file');

  const [loaded, setLoaded] = useState<Record<string, FileEntry[]>>({});
  const [content, setContent] = useState<string | null>(null);
  // What the server last confirmed, and the version it was. `draft` differs
  // from `content` exactly when there are unsaved edits, which is the only
  // definition of dirty this needs.
  const [draft, setDraft] = useState<string>('');
  const [etag, setEtag] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [language, setLanguage] = useState<Extension[]>([]);
  const [filter, setFilter] = useState('');

  const load = useCallback(
    (dir: string) => {
      if (projectId === undefined) return;
      void skill.listFiles(projectId, dir).then(
        entries => {
          setLoaded(prev => ({ ...prev, [dir]: entries }));
        },
        () => {
          // An unreadable directory reads as empty rather than taking the tree
          // down; the row stays, and its contents simply are not there.
          setLoaded(prev => ({ ...prev, [dir]: [] }));
        }
      );
    },
    [projectId]
  );

  useEffect(() => {
    setLoaded({});
    load('');
  }, [load]);

  useEffect(() => {
    if (projectId === undefined || selected === null) {
      setContent(null);
      return;
    }
    let live = true;
    setContent(null);
    setViewerError(null);
    void skill.readFileContent(projectId, selected).then(
      res => {
        if (!live) return;
        setContent(res.content);
        setDraft(res.content);
        setEtag(res.etag);
        setSaveError(null);
        setSavedAt(null);
      },
      (err: Error) => {
        if (live) setViewerError(refusalMessage(err));
      }
    );
    void loadLanguage(selected).then(ext => {
      if (live) setLanguage(ext);
    });
    return (): void => {
      live = false;
    };
  }, [projectId, selected]);

  const data = useMemo<Node[]>(() => {
    const build = (dir: string): Node[] =>
      (loaded[dir] ?? []).map(entry => {
        if (entry.kind !== 'dir') {
          return { id: entry.path, name: entry.name, kind: entry.kind, size: entry.size };
        }
        return {
          id: entry.path,
          name: entry.name,
          kind: entry.kind,
          size: entry.size,
          children: loaded[entry.path] === undefined ? UNREAD : build(entry.path),
        };
      });
    return build('');
  }, [loaded]);

  const dirty = content !== null && draft !== content;

  const save = useCallback((): void => {
    if (projectId === undefined || selected === null || etag === null || saving) return;
    setSaving(true);
    setSaveError(null);
    void skill.writeFileContent(projectId, selected, draft, etag).then(
      res => {
        // The saved text IS the file now, so it becomes the baseline and the
        // new token is what the next save will be judged against.
        setContent(draft);
        setEtag(res.etag);
        setSavedAt(Date.now());
        setSaving(false);
      },
      (err: Error) => {
        // A 409 means someone else wrote the file. Surfaced and left alone -
        // retrying with a fresh token is exactly the silent overwrite the
        // token exists to prevent.
        setSaveError(refusalMessage(err));
        setSaving(false);
      }
    );
  }, [projectId, selected, etag, draft, saving]);

  // Cmd/Ctrl-S, because nobody reaches for a button to save a file.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return (): void => {
      window.removeEventListener('keydown', onKey);
    };
  }, [save]);

  if (projectId === undefined) {
    return <EmptyState title="No project" hint="Pick a project to read its files." />;
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-border bg-surface-inset/40">
        <input
          value={filter}
          onChange={e => {
            setFilter(e.target.value);
          }}
          placeholder="Filter loaded tree..."
          className="m-2 rounded border border-border bg-surface px-2 py-1 font-mono text-[11.5px] text-text-primary outline-none focus:border-border-bright"
        />
        <div className="min-h-0 flex-1">
          <Tree<Node>
            data={data}
            openByDefault={false}
            width="100%"
            height={720}
            indent={14}
            rowHeight={22}
            searchTerm={filter}
            searchMatch={(node, term): boolean =>
              node.data.name.toLowerCase().includes(term.toLowerCase())
            }
            disableDrag
            disableDrop
            onToggle={id => {
              // Fetch a directory the first time it is opened, and never again.
              if (loaded[id] === undefined) load(id);
            }}
            onActivate={(node: NodeApi<Node>) => {
              if (node.data.kind !== 'file') return;
              setParams(prev => {
                const next = new URLSearchParams(prev);
                next.set('file', node.data.id);
                return next;
              });
            }}
          >
            {Row}
          </Tree>
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
          <span className="min-w-0 truncate font-mono text-[12px] text-text-secondary">
            {selected ?? 'No file selected'}
          </span>
          {dirty ? (
            <span
              aria-label="Unsaved changes"
              className="shrink-0 font-mono text-[11px] text-warning"
            >
              unsaved
            </span>
          ) : savedAt !== null ? (
            <span className="shrink-0 font-mono text-[11px] text-text-tertiary">saved</span>
          ) : null}
          {selected !== null ? (
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className="shrink-0 rounded border border-border px-2 py-0.5 font-mono text-[11px] text-text-secondary transition-colors hover:text-text-primary disabled:opacity-40"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          ) : null}
          <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            v2 · arborist + codemirror
          </span>
        </header>
        {saveError !== null ? (
          <p className="shrink-0 border-b border-error/30 bg-error/[0.06] px-4 py-1.5 font-mono text-[11.5px] text-error">
            {saveError}
          </p>
        ) : null}
        {selected === null ? (
          <EmptyState
            title="Nothing open"
            hint="Arrow keys move the tree. Cmd-F searches the file."
          />
        ) : viewerError !== null ? (
          <p className="px-6 py-4 font-mono text-[12px] text-error">{viewerError}</p>
        ) : content === null ? (
          <p className="px-6 py-4 font-mono text-[12px] text-text-tertiary">Loading...</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">
            <CodeMirror
              value={draft}
              onChange={setDraft}
              height="100%"
              style={{ height: '100%' }}
              theme={THEME}
              extensions={language}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                searchKeymap: true,
                highlightActiveLine: true,
                highlightActiveLineGutter: true,
                autocompletion: false,
              }}
            />
          </div>
        )}
      </section>
    </div>
  );
}

export default FilesV2Page;
