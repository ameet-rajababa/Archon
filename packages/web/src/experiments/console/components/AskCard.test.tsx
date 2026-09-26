import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AskCard } from './AskCard';
import type { AskSpec } from '../primitives/ask';

const noop = (): void => undefined;

function spec(allowOwn?: boolean): AskSpec {
  return {
    questions: [
      {
        title: 'Ship it?',
        options: [{ label: 'Yes' }, { label: 'No' }],
        ...(allowOwn === undefined ? {} : { allowOwn }),
      },
    ],
  };
}

describe('AskCard attachments', () => {
  // The free-text row is the only thing that can carry a file, so a question
  // that refuses free text must not grow an attach control by the side door.
  test('a question with allowOwn: false offers no free-text row to attach to', () => {
    const html = renderToStaticMarkup(<AskCard spec={spec(false)} onAnswer={noop} />);
    expect(html).not.toContain('Type your own');
    expect(html).not.toContain('Attach');
  });

  // A card being read rather than answered — history, or a turn in flight —
  // has no send of its own for a file to ride.
  test('a read-only card offers no free-text row and no attach control', () => {
    const html = renderToStaticMarkup(<AskCard spec={spec()} />);
    expect(html).not.toContain('Type your own');
    expect(html).not.toContain('Attach');
  });

  test('an answerable card offers the free-text row', () => {
    const html = renderToStaticMarkup(<AskCard spec={spec()} onAnswer={noop} />);
    expect(html).toContain('Type your own');
  });
});
