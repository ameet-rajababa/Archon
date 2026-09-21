import { Check, Search } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { clamp, hexToHsv, hsvToHex, isHexColor, type Hsv } from '../lib/color-hsv';
import { ICON_PATHS } from '../lib/glyph-data';
import { searchEmoji, searchIcons } from '../lib/glyph-search';
import { IDENTITY_COLORS, getIdentity, resolveColor, setIdentity } from '../lib/project-identity';
import { pushIdentity } from '../lib/presentation-sync';

/** Where the custom picker starts when the current color is a preset: a warm, obviously-editable orange. */
const CUSTOM_START: Hsv = { h: 28, s: 0.7, v: 0.95 };

/** Panel heights, for clamping to the viewport. The custom row is the taller of the two. */
const PANEL_PRESETS = 420;
const PANEL_CUSTOM = 560;

/**
 * Choose a project's icon and color.
 *
 * Ported from the prototype. Two vocabularies behind tabs, a color row above
 * both, and a ranked search — icons are tinted with the chosen color because
 * lucide is stroke art on currentColor, so one path set serves every color for
 * free. Emoji are NOT tinted: they carry their own color and always have.
 *
 * The color row has two faces. The presets are the common case; the rainbow
 * swatch swaps the row for a full custom picker — hex readout, saturation and
 * value field, vertical hue rail — and the rainbow in its corner swaps back.
 * One row, two modes, rather than a second panel to get lost in.
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

  // A project already wearing a custom color opens on the custom row. Landing
  // on the presets would show a row with no check in it and no sign of where
  // the current color came from.
  const [custom, setCustom] = useState(() => identity.color !== null && isHexColor(identity.color));
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color) ?? CUSTOM_START);
  const [hexText, setHexText] = useState(() => hsvToHex(hsv.h, hsv.s, hsv.v));
  // The pointer handlers live on window for the duration of a drag, so they
  // close over whatever `hsv` was when the gesture started. The ref is what
  // they read instead.
  const hsvRef = useRef(hsv);

  /**
   * What the panel paints with: the custom row previews its candidate, so the
   * readout, the dot, the knob and the icon grid all agree with each other.
   *
   * Opening the custom row does not change the project's color — nothing is
   * committed until you move something — so `color` and this can differ for as
   * long as the row sits untouched. The rail keeps showing the real color
   * meanwhile, which is the honest half of that split.
   */
  const paint = custom ? hsvToHex(hsv.h, hsv.s, hsv.v) : color;

  /**
   * Write a color change through to storage and the rail.
   *
   * `text: false` leaves the hex box exactly as typed — rewriting it under the
   * cursor turns "#3b82f" into a fight. `push: false` keeps a drag local; the
   * server save happens once on pointer up rather than on every frame of it.
   */
  const apply = (patch: Partial<Hsv>, opts: { text: boolean; push: boolean }): void => {
    const next = { ...hsvRef.current, ...patch };
    hsvRef.current = next;
    setHsv(next);
    const value = hsvToHex(next.h, next.s, next.v);
    if (opts.text) setHexText(value);
    setIdentity(projectId, { color: value });
    if (opts.push) pushIdentity(projectId);
    onChange();
  };

  /** Track the pointer across the whole window: a drag that leaves the square should keep working. */
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, axis: 'sv' | 'hue'): void => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const at = (point: { clientX: number; clientY: number }, push: boolean): void => {
      const x = clamp((point.clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((point.clientY - rect.top) / rect.height, 0, 1);
      apply(axis === 'sv' ? { s: x, v: 1 - y } : { h: y * 360 }, { text: true, push });
    };
    const onMove = (ev: PointerEvent): void => {
      at(ev, false);
    };
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      at(ev, true);
    };
    at(e.nativeEvent, false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

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
  const top = Math.min(
    rect.bottom + 6,
    window.innerHeight - (custom ? PANEL_CUSTOM : PANEL_PRESETS)
  );
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

      {custom ? (
        <div className="cust">
          <div className="cust-top">
            <span className="cust-dot" style={{ background: paint }} />
            <span className="cust-lab">HEX</span>
            <input
              className="cust-hex"
              value={hexText}
              spellCheck={false}
              aria-label="Hex color"
              onChange={e => {
                setHexText(e.target.value);
                const parsed = hexToHsv(e.target.value);
                if (parsed !== null) apply(parsed, { text: false, push: true });
              }}
              onBlur={() => {
                // Snap a half-typed or invalid value back to where the knobs
                // are, so the readout and the rest of the row never disagree.
                setHexText(hsvToHex(hsv.h, hsv.s, hsv.v));
              }}
            />
            <button
              type="button"
              className="rainbow cust-back"
              title="Preset colors"
              aria-label="Preset colors"
              onClick={() => {
                setCustom(false);
              }}
            />
          </div>
          <div className="cust-body">
            <div
              className="sv"
              style={{ background: `hsl(${hsv.h} 100% 50%)` }}
              aria-label="Saturation and brightness"
              onPointerDown={e => {
                startDrag(e, 'sv');
              }}
            >
              <span className="sv-white" />
              <span className="sv-black" />
              <span
                className="sv-knob"
                style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: paint }}
              />
            </div>
            <div
              className="hue"
              aria-label="Hue"
              onPointerDown={e => {
                startDrag(e, 'hue');
              }}
            >
              <span className="hue-knob" style={{ top: `${(hsv.h / 360) * 100}%` }} />
            </div>
          </div>
        </div>
      ) : (
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
          <span className="vr" />
          <button
            type="button"
            className="rainbow"
            title="Custom color"
            aria-label="Custom color"
            onClick={() => {
              setCustom(true);
            }}
          />
        </div>
      )}

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
              style={tab === 'icons' ? { color: paint } : undefined}
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
