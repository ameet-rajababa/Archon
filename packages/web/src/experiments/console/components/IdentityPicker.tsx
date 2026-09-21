import { Check, Search } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ICON_PATHS } from '../lib/glyph-data';
import { searchEmoji, searchIcons } from '../lib/glyph-search';
import { IDENTITY_COLORS, getIdentity, resolveColor, setIdentity } from '../lib/project-identity';
import { pushIdentity } from '../lib/presentation-sync';

/**
 * Choose a project's icon and color.
 *
 * Ported from the prototype. Two vocabularies behind tabs, a preset color row
 * above both, and a ranked search — icons are tinted with the chosen color
 * because lucide is stroke art on currentColor, so one path set serves every
 * color for free. Emoji are NOT tinted: they carry their own color and
 * always have.
 */
export function IdentityPicker({
  projectId,
  anchor,
  onClose,
  onChange,
}: {
  projectId: string;
  /**
   * The row to place against — the ELEMENT, not a rect.
   *
   * A rect captured at click time is stale the moment the rail scrolls, and a
   * null rect is indistinguishable from "closed", which is how this panel
   * silently stopped opening at all. RowMenu already takes the element for the
   * same reason.
   */
  anchor: HTMLElement;
  onClose: () => void;
  onChange: () => void;
}): ReactElement {
  const [tab, setTab] = useState<'icons' | 'emojis'>('icons');
  const [query, setQuery] = useState('');
  const identity = getIdentity(projectId);
  const color = resolveColor(projectId, identity);
  const ref = useRef<HTMLDivElement | null>(null);

  // Dismiss on outside click or Escape. Bound on the next tick so the click
  // that opened the picker does not immediately close it.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    const id = setTimeout(() => {
      window.addEventListener('mousedown', onDown);
    }, 0);
    window.addEventListener('keydown', onKey);
    return (): void => {
      clearTimeout(id);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const items = tab === 'icons' ? searchIcons(query) : searchEmoji(query);
  const chosenGlyph = identity.glyph;

  // Clamp to the viewport: the rail sits at the left edge, so only the bottom
  // realistically overflows.
  const rect = anchor.getBoundingClientRect();
  const top = Math.min(rect.bottom + 6, window.innerHeight - 420);
  const left = Math.min(rect.left, window.innerWidth - 404);

  return (
    <div ref={ref} className="pick" style={{ top: Math.max(8, top), left: Math.max(8, left) }}>
      <div className="pick-tabs">
        {(['icons', 'emojis'] as const).map(t => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => {
              setTab(t);
              setQuery('');
            }}
          >
            {t === 'icons' ? 'Icons' : 'Emojis'}
          </button>
        ))}
      </div>

      <div className="pick-colors">
        {IDENTITY_COLORS.map(c => (
          <button
            key={c.key}
            type="button"
            title={c.key}
            aria-label={c.key}
            style={{ background: c.value }}
            onClick={() => {
              setIdentity(projectId, { color: c.key });
              pushIdentity(projectId);
              onChange();
            }}
          >
            {identity.color === c.key ? <Check /> : null}
          </button>
        ))}
      </div>

      <div className="pick-search">
        <Search className="h-[13px] w-[13px] shrink-0 text-text-tertiary" />
        <input
          autoFocus
          value={query}
          spellCheck={false}
          placeholder={`Search ${tab}…`}
          aria-label={`Search ${tab}`}
          onChange={e => {
            setQuery(e.target.value);
          }}
        />
        <span className="pick-count">{items.length}</span>
      </div>

      {items.length === 0 ? (
        <div className="pick-empty">No matches.</div>
      ) : (
        <div className={`pick-grid${tab === 'emojis' ? ' is-emoji' : ''}`}>
          {items.map(k => (
            <button
              key={k}
              type="button"
              title={k}
              aria-label={k}
              aria-pressed={chosenGlyph === k}
              style={tab === 'icons' ? { color } : undefined}
              onClick={() => {
                setIdentity(projectId, { glyph: k });
                pushIdentity(projectId);
                onChange();
                onClose();
              }}
            >
              {tab === 'icons' ? (
                <svg
                  viewBox="0 0 24 24"
                  width={17}
                  height={17}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.9}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dangerouslySetInnerHTML={{ __html: ICON_PATHS[k] ?? '' }}
                />
              ) : (
                <span>{k}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
