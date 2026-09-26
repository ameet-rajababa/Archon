import type { ReactElement } from 'react';

interface AskErrorCardProps {
  /** Located explanation from `parseAskSpec`, e.g. "question 1: needs a non-empty `title`". */
  reason: string;
  /** The original block, fences and all, so the question is still readable. */
  text: string;
}

/**
 * A block that claimed to be an ask block and was not one.
 *
 * The console is the only place that reliably sees a finished reply, so it is
 * the only place this check can live. Before it existed the failure was silent:
 * a malformed block rendered as a JSON code block, which is exactly how the
 * format is *supposed* to degrade on clients that cannot draw a card. Here that
 * same rendering means a question the reader cannot click, and it shipped
 * unnoticed because nothing distinguished the two.
 *
 * So this is loud on purpose, and it still shows the original block underneath:
 * the question stays answerable by typing even while the card is broken. What
 * it adds is the reason — the specific field, located — because the author of
 * the block is usually an agent that will read this back on the next turn.
 */
export function AskErrorCard({ reason, text }: AskErrorCardProps): ReactElement {
  return (
    <div
      className="my-3 overflow-hidden rounded-[var(--radius-card)] border"
      style={{
        borderColor: 'color-mix(in oklch, var(--error), transparent 55%)',
        background: 'var(--error-soft)',
      }}
    >
      <div className="flex flex-col gap-1 px-3 py-2">
        <span
          className="text-[length:var(--text-micro)] font-medium tracking-wide uppercase"
          style={{ color: 'var(--error)' }}
        >
          Malformed ask block
        </span>
        <span
          className="font-mono text-[length:var(--text-small)] leading-[1.5]"
          style={{ color: 'var(--error)' }}
        >
          {reason}
        </span>
      </div>
      <pre
        className="overflow-x-auto px-3 py-2 font-mono text-[length:var(--text-micro)] leading-[1.6] whitespace-pre"
        style={{ background: 'var(--surface-inset)', color: 'var(--text-secondary)' }}
      >
        {text}
      </pre>
    </div>
  );
}
