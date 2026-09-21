import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentAvatar } from './AgentAvatar';
import { StreamContextProvider } from '../lib/stream-context';
import { IDENTITY_COLORS } from '../lib/identity';

const preset = (key: string): string =>
  IDENTITY_COLORS.find(c => c.key === key)?.value ?? `no such preset: ${key}`;

describe('the agent avatar', () => {
  test('inside a chat, it wears the mark of the assistant that answers it', () => {
    // The point of a per-assistant mark: a codex chat must not be painted with
    // claude's. The chat declares its provider; the avatar obeys it rather
    // than reading the installation's current default.
    const html = renderToStaticMarkup(
      <StreamContextProvider value={{ runStartedAt: null, assistant: 'codex' }}>
        <AgentAvatar />
      </StreamContextProvider>
    );
    expect(html).toContain(preset('green'));
    expect(html).toContain('Change the codex icon and color');
  });

  test('outside a chat, it falls back to the configured assistant', () => {
    // The rail head belongs to no conversation. With nothing fetched yet that
    // resolves to the install default, which must still paint a real mark.
    const html = renderToStaticMarkup(<AgentAvatar size={18} />);
    expect(html).toContain(preset('orange'));
    expect(html).toContain('Change the claude icon and color');
  });

  test('the ring carries the color, and the mark is a stroked glyph', () => {
    // What the rewrite was for: the old avatar hard-coded a brand gradient
    // around a PNG, so a chosen color had nowhere to land.
    const html = renderToStaticMarkup(
      <StreamContextProvider value={{ runStartedAt: null, assistant: 'pi' }}>
        <AgentAvatar />
      </StreamContextProvider>
    );
    expect(html).toContain(`border:1.6px solid ${preset('indigo')}`);
    expect(html).toContain(`stroke="${preset('indigo')}"`);
    expect(html).not.toContain('linearGradient');
    expect(html).not.toContain('favicon.png');
  });
});
