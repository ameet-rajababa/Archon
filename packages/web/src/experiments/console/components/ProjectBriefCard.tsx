import { Pencil } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { EMPTY_BRIEF, getBrief, isEmpty, setBrief, type ProjectBrief } from '../lib/project-brief';
import { relativeTime } from '../lib/format';

const FIELDS: readonly {
  key: keyof Omit<ProjectBrief, 'updatedAt'>;
  label: string;
  hint: string;
}[] = [
  { key: 'why', label: 'Why', hint: 'Why this project exists.' },
  { key: 'doing', label: 'Doing', hint: 'What is being worked on now.' },
  { key: 'where', label: 'Where', hint: 'Where it has got to.' },
];

/**
 * The standing answer to "what is this and where is it".
 *
 * Three labelled parts rather than a paragraph, from the prototype. The split
 * is what keeps it honest: the part that goes out of date is visibly a
 * different field from the part that does not, so a stale "Doing" cannot
 * quietly discredit a "Why" that is still true.
 *
 * Empty says so and offers to be written. A confident blank card reads as
 * "there is nothing to say about this project", which is never what is meant.
 */
export function ProjectBriefCard({ projectId }: { projectId: string }): ReactElement {
  const [brief, setLocal] = useState<ProjectBrief>(() => getBrief(projectId));
  const [editing, setEditing] = useState(false);

  const commit = (key: keyof Omit<ProjectBrief, 'updatedAt'>, value: string): void => {
    setBrief(projectId, { [key]: value });
    setLocal(getBrief(projectId));
  };

  if (!editing && isEmpty(brief)) {
    return (
      <button
        type="button"
        onClick={() => {
          setEditing(true);
        }}
        className="flex w-full items-center gap-2 rounded-[10px] border border-dashed border-border px-4 py-3 text-left text-[13px] text-text-tertiary transition-colors hover:border-border-bright hover:text-text-secondary"
      >
        <Pencil className="h-3.5 w-3.5 shrink-0" />
        Say why this project exists, what you are doing, and where it has got to.
      </button>
    );
  }

  return (
    <div className="rounded-[10px] border border-border bg-surface px-4 py-3">
      <div className="flex flex-col gap-2.5">
        {FIELDS.map(({ key, label, hint }) => {
          const value = brief[key];
          if (!editing && value.trim() === '') return null;
          return (
            <div key={key} className="flex gap-3">
              <span className="w-[44px] shrink-0 pt-[2px] font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-text-tertiary">
                {label}
              </span>
              {editing ? (
                <textarea
                  defaultValue={value}
                  rows={key === 'why' ? 2 : 2}
                  placeholder={hint}
                  onBlur={e => {
                    commit(key, e.target.value);
                  }}
                  className="min-w-0 flex-1 resize-none rounded border border-border bg-surface-inset px-2 py-1 text-[13px] leading-[1.5] text-text-primary outline-none focus:border-border-bright"
                />
              ) : (
                <span className="min-w-0 flex-1 text-[13px] leading-[1.5] text-text-secondary">
                  {value}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-border pt-2">
        {brief.updatedAt !== null ? (
          <span className="font-mono text-[10px] text-text-tertiary">
            written {relativeTime(new Date(brief.updatedAt).toISOString())}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => {
            if (editing) setLocal(getBrief(projectId));
            setEditing(v => !v);
          }}
          className="ml-auto rounded border border-border px-2 py-0.5 font-mono text-[10.5px] text-text-secondary transition-colors hover:border-border-bright hover:text-text-primary"
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
    </div>
  );
}

export { EMPTY_BRIEF };
