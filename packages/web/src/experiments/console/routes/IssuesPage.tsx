import { ExternalLink, RefreshCw } from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';
import { EmptyState } from '../components/EmptyState';
import {
  COLUMN_REASON,
  ISSUE_COLUMNS,
  issueAreas,
  issueColumn,
  issueType,
  runningIssues,
  TYPE_COLOR,
  type IssueColumn,
} from '../primitives/issue-board';
import type { Run } from '../primitives/run';
import * as skill from '../skills';
import type { GithubIssue, IssuesResponse } from '../skills';
import { invalidate, useEntity } from '../store/cache';
import { K } from '../store/keys';
import { useParams } from 'react-router';

/** Why a board is legitimately empty, in the words a person would use. */
const REASON_TEXT: Readonly<Record<string, string>> = {
  'no-repository': 'This project has no repository, so there is nothing to read.',
  'not-github': 'This project’s remote is not GitHub.',
  'no-token': 'No GitHub token is configured on the server.',
  unreachable: 'GitHub could not be reached.',
};

function Card({ issue, column }: { issue: GithubIssue; column: IssueColumn }): ReactElement {
  const type = issueType(issue);
  const areas = issueAreas(issue);
  return (
    // The card IS the link. GitHub owns this issue and Archon is a view of it,
    // so the obvious click goes to the source rather than to a local copy that
    // would then have to be kept honest.
    <a
      href={issue.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`${COLUMN_REASON[column]}\nOpens on github.com`}
      className="group block rounded-[9px] border border-border bg-surface px-3 py-2.5 transition-colors hover:border-border-bright hover:bg-surface-hover"
    >
      <div className="text-[13px] leading-[1.4] text-text-primary">{issue.title}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10.5px] text-text-tertiary">#{issue.number}</span>
        {type !== null ? (
          <span
            title={type.derived ? 'Derived from a label — no GitHub type set' : 'GitHub issue type'}
            className="inline-flex h-[17px] items-center rounded-full px-[7px] text-[9.5px] font-semibold uppercase tracking-[0.05em]"
            style={{
              color: TYPE_COLOR[type.name] ?? 'var(--text-secondary)',
              border: `1px ${type.derived ? 'dashed' : 'solid'} ${TYPE_COLOR[type.name] ?? 'var(--border-bright)'}`,
            }}
          >
            {type.name}
          </span>
        ) : null}
        {areas.map(a => (
          <span
            key={a.name}
            className="inline-flex h-[17px] items-center rounded-full border px-[7px] text-[10px]"
            style={{ borderColor: a.color, color: 'var(--text-secondary)' }}
          >
            {a.name}
          </span>
        ))}
        <ExternalLink className="ml-auto h-3 w-3 shrink-0 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </a>
  );
}

/**
 * A read-only board over the project's GitHub issues.
 *
 * GitHub alone gives you two columns — open and closed. The two in the middle
 * come from joining it to what Archon already knows: an open PR that closes an
 * issue, and a run that is executing against one. Hovering a card says which
 * source placed it.
 *
 * Nothing here writes to GitHub.
 */
export function IssuesPage(): ReactElement {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const [hidden, setHidden] = useState<ReadonlySet<IssueColumn>>(() => new Set());
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const { data, loading, error } = useEntity<IssuesResponse>(K.issues(projectId), () =>
    skill.listIssues(projectId)
  );
  const { data: feed } = useEntity<{ runs: Run[] }>(K.runs(projectId), () =>
    skill.listRuns({ codebaseId: projectId, limit: skill.RUN_LIMIT })
  );

  const issues = data?.issues ?? [];
  const running = useMemo(() => runningIssues(feed?.runs ?? []), [feed?.runs]);
  const types = useMemo(
    () => [
      ...new Set(issues.map(i => issueType(i)?.name).filter((t): t is string => t !== undefined)),
    ],
    [issues]
  );

  const byColumn = useMemo(() => {
    const out = new Map<IssueColumn, GithubIssue[]>(ISSUE_COLUMNS.map(c => [c.key, []]));
    for (const i of issues) {
      const t = issueType(i)?.name;
      if (typeFilter !== null && t !== typeFilter) continue;
      out.get(issueColumn(i, running))?.push(i);
    }
    return out;
  }, [issues, running, typeFilter]);

  if (error !== undefined) {
    return <EmptyState title="Could not read the issues." hint={error.message} />;
  }
  if (loading && data === undefined) return <EmptyState title="Reading GitHub…" />;

  // An empty board that cannot say WHY reads as "you have no issues", which is
  // a different and usually false statement.
  if (issues.length === 0) {
    return (
      <EmptyState
        title={
          data?.reason !== null && data?.reason !== undefined ? 'No issues to show.' : 'No issues.'
        }
        hint={
          data?.reason !== null && data?.reason !== undefined
            ? (REASON_TEXT[data.reason] ?? data.reason)
            : `${data?.repo ?? 'This repository'} has no issues.`
        }
      />
    );
  }

  const visible = ISSUE_COLUMNS.filter(c => !hidden.has(c.key));
  const hiddenCount =
    issues.length -
    [...byColumn].filter(([k]) => !hidden.has(k)).reduce((n, [, v]) => n + v.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-8 pb-6 pt-4">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-text-tertiary">
          {data?.repo ?? ''} · read-only
        </span>
        <button
          type="button"
          title="Refresh from GitHub"
          onClick={() => {
            invalidate(K.issues(projectId));
          }}
          className="rail-ibtn"
        >
          <RefreshCw className="h-[13px] w-[13px]" />
        </button>

        {types.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTypeFilter(v => (v === t ? null : t));
            }}
            className="inline-flex h-[19px] items-center rounded-full border px-[8px] text-[9.5px] font-semibold uppercase tracking-[0.05em] transition-opacity"
            style={{
              color: TYPE_COLOR[t] ?? 'var(--text-secondary)',
              borderColor: TYPE_COLOR[t] ?? 'var(--border-bright)',
              opacity: typeFilter !== null && typeFilter !== t ? 0.38 : 1,
            }}
          >
            {t}
          </button>
        ))}

        {hidden.size > 0 ? (
          <button
            type="button"
            onClick={() => {
              setHidden(new Set());
            }}
            className="ml-auto text-[11px] text-text-tertiary hover:text-text-primary"
          >
            {hiddenCount} issue{hiddenCount === 1 ? '' : 's'} in {hidden.size} hidden column
            {hidden.size === 1 ? '' : 's'} — show all
          </button>
        ) : null}
      </div>

      <div
        className="grid min-h-0 flex-1 gap-2.5"
        style={{ gridTemplateColumns: `repeat(${String(visible.length)}, minmax(0, 1fr))` }}
      >
        {visible.map(col => {
          const items = byColumn.get(col.key) ?? [];
          return (
            <section key={col.key} className="group/col flex min-h-0 flex-col">
              <div className="flex items-center gap-1.5 px-1 pb-2">
                <span
                  aria-hidden
                  className="h-[7px] w-[7px] shrink-0 rounded-full"
                  style={{ background: col.color }}
                />
                <span className="text-[12px] font-medium text-text-secondary">{col.label}</span>
                <span className="font-mono text-[11px] text-text-tertiary">{items.length}</span>
                <button
                  type="button"
                  title={`Hide ${col.label}`}
                  aria-label={`Hide ${col.label}`}
                  onClick={() => {
                    setHidden(prev => new Set(prev).add(col.key));
                  }}
                  className="rail-ibtn ml-auto opacity-0 transition-opacity group-hover/col:opacity-100"
                >
                  ✕
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
                {items.length === 0 ? (
                  <p className="px-1 py-1.5 text-[11px] text-text-tertiary">
                    {col.key === 'rev'
                      ? 'no open PR closes an issue right now'
                      : col.key === 'prog'
                        ? 'no run is working on an issue right now'
                        : '—'}
                  </p>
                ) : (
                  items.map(i => <Card key={i.number} issue={i} column={col.key} />)
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
