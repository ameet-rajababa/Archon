import { type ReactElement } from 'react';
import { SettingsSection } from './SettingsSection';
import {
  setAppearance,
  useAppearance,
  type ModePref,
  type ThemeName,
} from '../../../theme/appearance';
import {
  formatClockIn,
  getClockFormat,
  setClockFormat,
  useClock,
  type ClockFormat,
} from '../lib/clock';

const CLOCK_OPTIONS: readonly { value: ClockFormat; label: string }[] = [
  { value: '12', label: '12-hour' },
  { value: '24', label: '24-hour' },
];

const THEME_OPTIONS: readonly { value: ThemeName; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'archon', label: 'Archon' },
];

const MODE_OPTIONS: readonly { value: ModePref; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

/**
 * A segmented choice. Three of these now live on this panel, which is one more
 * than is worth repeating by hand — and the shape it settles on is what the
 * shared primitives will adopt.
 */
function Segmented<T extends string>({
  options,
  active,
  onPick,
  label,
}: {
  options: readonly { value: T; label: string }[];
  active: T;
  onPick: (value: T) => void;
  label: string;
}): ReactElement {
  return (
    <div className="flex shrink-0 items-center gap-1.5" role="group" aria-label={label}>
      {options.map(({ value, label: text }) => (
        <button
          key={value}
          type="button"
          onClick={() => {
            onPick(value);
          }}
          aria-pressed={active === value}
          className={`rounded-[8px] border px-2.5 py-1 font-mono text-[11px] transition-colors ${
            active === value ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary'
          }`}
          style={{
            borderColor: active === value ? 'var(--border-bright)' : 'var(--border)',
            background: active === value ? 'var(--surface-elevated)' : 'transparent',
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Row({
  title,
  hint,
  children,
  divided = true,
}: {
  title: string;
  hint: string;
  children: ReactElement;
  divided?: boolean;
}): ReactElement {
  return (
    <div
      className={`flex items-center justify-between gap-4 py-2 ${
        divided ? 'border-t border-border pt-2.5' : ''
      }`}
    >
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-text-primary">{title}</div>
        <div className="mt-0.5 text-[11.5px] text-text-tertiary">{hint}</div>
      </div>
      {children}
    </div>
  );
}

/**
 * How the console renders things, as opposed to what it does.
 *
 * Theme, mode and text size write to <html data-theme data-mode data-text>,
 * where the token layer in theme/tokens.css reads them.
 *
 * Text size is five steps, 6% apart — small enough that any neighbouring pair
 * is a real but not jarring change, wide enough that XS to XL is about 26%. It
 * scales the root font size, so everything expressed in rem follows. Sizes
 * still written as absolute pixels do not, which is a known and shrinking
 * remainder rather than a reason to withhold the control.
 */
const DENSITY_OPTIONS = [
  // The token is `comfortable`; the label is the word people say.
  { value: 'comfortable' as const, label: 'Cozy' },
  { value: 'compact' as const, label: 'Compact' },
];

const TEXT_OPTIONS = [
  { value: 'xs' as const, label: 'XS' },
  { value: 's' as const, label: 'S' },
  { value: 'm' as const, label: 'M' },
  { value: 'l' as const, label: 'L' },
  { value: 'xl' as const, label: 'XL' },
];

export function AppearancePanel(): ReactElement {
  const appearance = useAppearance();
  // Subscribing here is what makes the preview update the instant you pick.
  const clock = useClock();
  const activeClock = getClockFormat();
  // A fixed afternoon instant, so the preview actually shows the difference —
  // a morning time looks nearly identical in both formats.
  const sample = new Date();
  sample.setHours(20, 6, 24, 0);
  const sampleIso = sample.toISOString();

  return (
    <SettingsSection title="Appearance">
      <Row
        title="Theme"
        hint="Linear is a restrained neutral palette. Archon carries the brand magenta and its gradient."
        divided={false}
      >
        <Segmented
          label="Theme"
          options={THEME_OPTIONS}
          active={appearance.theme}
          onPick={theme => {
            setAppearance({ theme });
          }}
        />
      </Row>
      <Row
        title="Text size"
        hint="Scales the whole interface, not just the text. Five steps, 6% apart."
      >
        <Segmented
          label="Text size"
          options={TEXT_OPTIONS}
          active={appearance.text}
          onPick={text => {
            setAppearance({ text });
          }}
        />
      </Row>
      <Row
        title="Density"
        hint="How much air a row gets. Compact fits about a third more in the same height."
      >
        <Segmented
          label="Density"
          options={DENSITY_OPTIONS}
          active={appearance.density}
          onPick={density => {
            setAppearance({ density });
          }}
        />
      </Row>
      <Row title="Mode" hint="System follows your operating system, and changes with it.">
        <Segmented
          label="Mode"
          options={MODE_OPTIONS}
          active={appearance.mode}
          onPick={mode => {
            setAppearance({ mode });
          }}
        />
      </Row>
      <Row
        title="Time format"
        hint="How timestamps on messages and runs are shown. Defaults to your browser's locale."
      >
        <Segmented
          label="Time format"
          options={CLOCK_OPTIONS}
          active={activeClock}
          onPick={setClockFormat}
        />
      </Row>
      <div className="flex items-baseline gap-3 border-t border-border pt-2.5">
        <span className="font-mono text-[10.5px] tracking-[0.12em] text-text-tertiary">
          PREVIEW
        </span>
        <span className="font-mono text-[12.5px] text-text-secondary">{clock(sampleIso)}</span>
        <span className="font-mono text-[10.5px] text-text-tertiary">
          (other: {formatClockIn(sampleIso, activeClock === '12' ? '24' : '12')})
        </span>
      </div>
    </SettingsSection>
  );
}
