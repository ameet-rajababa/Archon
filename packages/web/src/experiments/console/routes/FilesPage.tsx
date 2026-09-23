/**
 * Files — read a project's checkout (#23).
 *
 * The split layout (option A of the three the preview offered): a lazily
 * loaded directory tree pinned left, a read-only viewer right. Orientation
 * stays on screen, and moving between two files is one click.
 *
 * LAZY BY CONSTRUCTION, not by care. Each directory row is its own component
 * that reads its own cache key, and a collapsed directory does not mount. So
 * "expanding loads exactly one directory" is a property of the tree's shape
 * rather than a rule someone has to remember while editing it.
 *
 * Highlighting reuses the console's existing `react-markdown` +
 * `rehype-highlight` path — the same one YamlPreview, ArtifactPanel and
 * MessageItem use — rather than adding a viewer dependency. Read-only is the
 * whole feature here; if it ever goes editable, CodeMirror becomes a
 * deliberate choice at that point.
 */
import { useState, type ReactElement } from 'react';
import { useParams } from 'react-router';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { useEntity } from '../store/cache';
import { K } from '../store/keys';
import * as skill from '../skills';
import { EmptyState } from '../components/EmptyState';
import { HttpError } from '../lib/http';
import { formatBytes, languageFor, type FileEntry } from '../primitives/file-entry';

const REHYPE_PLUGINS = [rehypeHighlight];

/**
 * The server's own words for a refusal, which are the useful ones: "binary
 * file", "over the size ceiling", "not found". Falls back to the raw message
 * when the body is not the JSON error shape — `bodySnippet` is truncated, so
 * a parse failure is expected rather than exceptional.
 */
function refusalMessage(error: Error): string {
  if (!(error instanceof HttpError)) return error.message;
  try {
    const parsed: unknown = JSON.parse(error.bodySnippet);
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const value = (parsed as { error: unknown }).error;
      if (typeof value === 'string') return value;
    }
  } catch {
    // Not JSON, or cut mid-object by the snippet cap. The status line below
    // still says what happened.
  }
  return `Could not read this file (HTTP ${String(error.status)}).`;
}

interface TreeProps {
  projectId: string;
  dir: string;
  selected: string | null;
  onSelect: (path: string) => void;
  depth: number;
}

/**
 * One directory level. Mounted only when its parent is expanded, which is what
 * keeps the whole tree to one request per opened folder.
 */
function TreeLevel({ projectId, dir, selected, onSelect, depth }: TreeProps): ReactElement {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const { data, error } = useEntity<FileEntry[]>(K.files(projectId, dir), () =>
    skill.listFiles(projectId, dir)
  );

  if (error !== undefined) {
    return (
      <p
        className="px-2 py-1 font-mono text-[11px] text-error"
        style={{ paddingLeft: indent(depth) }}
      >
        {refusalMessage(error)}
      </p>
    );
  }
  if (data === undefined) {
    return (
      <p
        className="px-2 py-1 font-mono text-[11px] text-text-tertiary"
        style={{ paddingLeft: indent(depth) }}
      >
        Loading…
      </p>
    );
  }
  if (data.length === 0) {
    return (
      <p
        className="px-2 py-1 font-mono text-[11px] text-text-tertiary"
        style={{ paddingLeft: indent(depth) }}
      >
        Empty
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {data.map(entry => {
        const isOpen = open.has(entry.path);
        const isSelected = entry.path === selected;
        return (
          <li key={entry.path}>
            <button
              type="button"
              aria-expanded={entry.kind === 'dir' ? isOpen : undefined}
              aria-current={isSelected ? 'true' : undefined}
              disabled={entry.kind === 'other'}
              onClick={() => {
                if (entry.kind === 'dir') {
                  setOpen(prev => {
                    const next = new Set(prev);
                    if (next.has(entry.path)) next.delete(entry.path);
                    else next.add(entry.path);
                    return next;
                  });
                  return;
                }
                if (entry.kind === 'file') onSelect(entry.path);
              }}
              style={{ paddingLeft: indent(depth) }}
              className={`flex w-full items-center gap-1.5 py-[3px] pr-2 text-left text-[12.5px] transition-colors ${
                isSelected
                  ? 'bg-surface-elevated text-text-primary'
                  : entry.kind === 'other'
                    ? 'text-text-tertiary'
                    : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
              }`}
            >
              <span aria-hidden className="w-3 shrink-0 font-mono text-[10px] text-text-tertiary">
                {entry.kind === 'dir' ? (isOpen ? '▾' : '▸') : ''}
              </span>
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.kind === 'file' ? (
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-tertiary">
                  {formatBytes(entry.size)}
                </span>
              ) : null}
            </button>
            {entry.kind === 'dir' && isOpen ? (
              <TreeLevel
                projectId={projectId}
                dir={entry.path}
                selected={selected}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Indent per level, in pixels. Deep trees stop indenting rather than vanish off the left. */
function indent(depth: number): number {
  return 8 + Math.min(depth, 8) * 11;
}

/**
 * Wrap the file in a fence so `rehype-highlight` applies a grammar. The fence
 * length exceeds the longest backtick run in the content, so a file that
 * itself contains a Markdown fence cannot break out of the block.
 */
function toFence(text: string, language: string): string {
  const longestRun = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

function Viewer({ projectId, path }: { projectId: string; path: string }): ReactElement {
  const { data, error } = useEntity<skill.FileContent>(K.fileContent(projectId, path), () =>
    skill.readFileContent(projectId, path)
  );

  if (error !== undefined) {
    return (
      <div className="px-6 py-4">
        <p className="font-mono text-[12px] text-error">{refusalMessage(error)}</p>
      </div>
    );
  }
  if (data === undefined) {
    return <p className="px-6 py-4 font-mono text-[12px] text-text-tertiary">Loading…</p>;
  }

  const lines = data.content.split('\n');
  // A trailing newline yields a final empty element that is not a line of the
  // file; numbering it would make every file look one line longer than it is.
  const lineCount =
    lines.length > 1 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex min-w-max items-start">
        {/* The gutter is a sibling column, not per-line markup: highlighting a
            file line by line would break every construct that spans lines — a
            block comment, a template literal. Alignment holds because both
            columns share the type size and line height, and the code pane does
            not wrap. */}
        <div
          aria-hidden
          className="sticky left-0 select-none border-r border-border bg-surface px-2 py-2 text-right font-mono text-[12px] leading-[1.5] text-text-tertiary tabular-nums"
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        {/* Same arrangement YamlPreview uses: the global `.hljs` rule paints the
            code background, so the block's own margins and background are
            stripped and the pane behind it shows through. `whitespace-pre`
            keeps every line one line, which is what the gutter is aligned to. */}
        <div className="font-mono text-[12px] leading-[1.5] [&_pre]:m-0 [&_pre]:p-0 [&_pre]:px-3 [&_pre]:py-2 [&_pre_code]:!bg-transparent [&_pre_code]:whitespace-pre">
          <ReactMarkdown rehypePlugins={REHYPE_PLUGINS}>
            {toFence(data.content, languageFor(path))}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

export function FilesPage(): ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const [selected, setSelected] = useState<string | null>(null);
  // Narrow windows: the tree becomes a drawer rather than squeezing the
  // viewer. This is the split layout's known weakness, so it gets a stated
  // behaviour instead of an emergent one.
  const [treeOpen, setTreeOpen] = useState(false);

  if (projectId === undefined) {
    return <EmptyState title="No project" hint="Pick a project to read its files." />;
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className={`${
          treeOpen ? 'fixed inset-y-0 left-0 z-30 flex w-[260px] shadow-xl' : 'hidden md:flex'
        } shrink-0 flex-col border-r border-border bg-surface-inset/40 md:static md:z-auto md:w-[260px] md:shadow-none`}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-text-tertiary">
            Files · read-only
          </span>
          <button
            type="button"
            onClick={() => {
              setTreeOpen(false);
            }}
            className="font-mono text-[11px] text-text-tertiary hover:text-text-primary md:hidden"
          >
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto py-1">
          <TreeLevel
            projectId={projectId}
            dir=""
            selected={selected}
            onSelect={path => {
              setSelected(path);
              setTreeOpen(false);
            }}
            depth={0}
          />
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
          <button
            type="button"
            onClick={() => {
              setTreeOpen(true);
            }}
            className="rounded border border-border px-2 py-0.5 font-mono text-[11px] text-text-secondary hover:text-text-primary md:hidden"
          >
            Tree
          </button>
          <span className="min-w-0 truncate font-mono text-[12px] text-text-secondary">
            {selected ?? 'No file selected'}
          </span>
        </header>
        {selected === null ? (
          <EmptyState
            title="Nothing open"
            hint="Pick a file from the tree to read it. Files are read-only here."
          />
        ) : (
          <Viewer projectId={projectId} path={selected} />
        )}
      </section>
    </div>
  );
}
