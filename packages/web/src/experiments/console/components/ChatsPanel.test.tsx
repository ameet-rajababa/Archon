import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatFillPreview } from './ChatsPanel';
import { Switch } from './SettingsFormPrimitives';

const noop = (): void => undefined;

/**
 * The band is the only thing that says which threshold speaks first.
 *
 * Its three segments are the two thresholds and the gap between them, so a
 * swapped or miscomputed width is a picture that disagrees with the numbers
 * printed directly beneath it — a wrong answer that looks authoritative.
 */
describe('ChatFillPreview', () => {
  test('the segments are quiet, then the gap between the thresholds, then the rest', () => {
    const html = renderToStaticMarkup(<ChatFillPreview nudge={40} handoff={55} />);
    expect(html).toContain('flex:0 0 40%');
    // The middle segment is the SPAN between the two, not the handoff point —
    // 55% here would push the red band off the end of the bar.
    expect(html).toContain('flex:0 0 15%');
  });

  test('the labels carry the live numbers, not the defaults', () => {
    const html = renderToStaticMarkup(<ChatFillPreview nudge={25} handoff={70} />);
    expect(html).toContain('25% — nudge');
    expect(html).toContain('70% — hand off');
  });

  test('an inverted pair draws nothing rather than a negative segment', () => {
    // Reachable mid-edit, between raising the nudge and raising the handoff.
    // A negative flex-basis renders as a bar that silently lies about order.
    expect(renderToStaticMarkup(<ChatFillPreview nudge={70} handoff={50} />)).toBe('');
    expect(renderToStaticMarkup(<ChatFillPreview nudge={50} handoff={50} />)).toBe('');
  });
});

/**
 * The automatic-handoff row is a LIVE control.
 *
 * It was drawn greyed and captioned "not implemented" in the settings mockup,
 * which was true then — the auto-handoff path shipped afterwards and reads the
 * value on every turn. These assertions are what stops it regressing to
 * decoration.
 */
describe('Switch', () => {
  test('is a real switch, reachable by keyboard and named to a screen reader', () => {
    const html = renderToStaticMarkup(
      <Switch label="Hand off automatically" checked onChange={noop} />
    );
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="Hand off automatically"');
    // A `div` with a click listener is what the mockup used; it is not
    // focusable and not announced as a control.
    expect(html).toContain('<button');
    expect(html).not.toContain('disabled=""');
  });

  test('off reads as off', () => {
    const html = renderToStaticMarkup(
      <Switch label="Hand off automatically" checked={false} onChange={noop} />
    );
    expect(html).toContain('aria-checked="false"');
  });
});
