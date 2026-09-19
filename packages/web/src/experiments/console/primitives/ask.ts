/**
 * Ask blocks — the agent's multiple-choice questions, rendered as something you
 * can click instead of something you have to answer by typing a letter.
 *
 * The agent writes a fenced ```ask block holding JSON. The chat splits a reply
 * on those fences and renders the blocks as cards, leaving the prose around
 * them as ordinary markdown.
 *
 * The fence is the contract, and it degrades safely. A client that does not
 * know about ask blocks — an older bundle, a Telegram relay, a plain-text
 * export — renders the JSON as a code block, which is ugly but complete: every
 * question and option is still legible. Nothing is hidden behind the renderer.
 *
 * Answering is just sending a message. The chat is a conversation, so a click
 * composes the same text a person would have typed and sends it; the agent
 * needs no new channel and no new state. That is also why a whole set of
 * questions is answered in one submission: the answers do not exist anywhere
 * until they are sent, so paging back and changing one costs nothing.
 */

export interface AskOption {
  /** Short label — the choice itself, e.g. "Dead — archive it." */
  label: string;
  /** Optional reasoning shown under the label. */
  detail?: string;
  /** At most one option per question should set this. */
  recommended?: boolean;
  /** Why this one is recommended. Only meaningful with `recommended`. */
  why?: string;
}

export interface AskQuestion {
  /** The question itself. */
  title: string;
  /** Optional evidence paragraph shown above the question. */
  evidence?: string;
  /** Optional label for the subject of the question, shown as a chip. */
  chip?: string;
  options: AskOption[];
  /** Whether to offer a free-text answer. Defaults to true. */
  allowOwn?: boolean;
}

export interface AskSpec {
  questions: AskQuestion[];
}

/** A reply is a sequence of prose runs and ask cards. */
export type ReplyPart = { kind: 'markdown'; text: string } | { kind: 'ask'; spec: AskSpec };

/**
 * Validate parsed JSON as an {@link AskSpec}.
 *
 * Returns null rather than throwing, and the caller falls back to rendering the
 * block as code. A malformed block must never blank a reply — the text is the
 * thing the user came for, and a question they can read but not click still
 * works.
 */
export function parseAskSpec(raw: string): AskSpec | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;

  const questions = (value as { questions?: unknown }).questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;

  const parsed: AskQuestion[] = [];
  for (const q of questions) {
    if (typeof q !== 'object' || q === null) return null;
    const { title, evidence, chip, options, allowOwn } = q as Record<string, unknown>;
    if (typeof title !== 'string' || title.trim().length === 0) return null;
    if (!Array.isArray(options) || options.length === 0) return null;

    const parsedOptions: AskOption[] = [];
    for (const o of options) {
      if (typeof o !== 'object' || o === null) return null;
      const { label, detail, recommended, why } = o as Record<string, unknown>;
      if (typeof label !== 'string' || label.trim().length === 0) return null;
      parsedOptions.push({
        label,
        ...(typeof detail === 'string' ? { detail } : {}),
        ...(recommended === true ? { recommended: true } : {}),
        ...(typeof why === 'string' ? { why } : {}),
      });
    }

    parsed.push({
      title,
      ...(typeof evidence === 'string' ? { evidence } : {}),
      ...(typeof chip === 'string' ? { chip } : {}),
      options: parsedOptions,
      ...(allowOwn === false ? { allowOwn: false } : {}),
    });
  }

  return { questions: parsed };
}

/** Opening fence for an ask block, at the start of a line. */
const ASK_FENCE = /^[ \t]*```ask[ \t]*$/;
/** Any closing fence. */
const CLOSE_FENCE = /^[ \t]*```[ \t]*$/;

/**
 * Split a reply into prose and ask cards.
 *
 * Line-based rather than a single regex so an unterminated fence — a block
 * still streaming in, or one the agent truncated — degrades to prose instead of
 * swallowing the rest of the message. A block that does not parse is left as
 * the original text, fences and all, so markdown renders it as code.
 */
export function splitReply(content: string): ReplyPart[] {
  const lines = content.split('\n');
  const parts: ReplyPart[] = [];
  let prose: string[] = [];

  const flushProse = (): void => {
    const text = prose.join('\n');
    if (text.trim().length > 0) parts.push({ kind: 'markdown', text });
    prose = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!ASK_FENCE.test(line)) {
      prose.push(line);
      continue;
    }

    // Collect to the closing fence. Without one, this was not a block.
    const body: string[] = [];
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (CLOSE_FENCE.test(lines[j] ?? '')) {
        close = j;
        break;
      }
      body.push(lines[j] ?? '');
    }
    if (close === -1) {
      prose.push(line);
      continue;
    }

    const spec = parseAskSpec(body.join('\n'));
    if (spec === null) {
      // Keep it readable as code rather than dropping the question entirely.
      prose.push(line, ...body, lines[close] ?? '```');
    } else {
      flushProse();
      parts.push({ kind: 'ask', spec });
    }
    i = close;
  }

  flushProse();
  return parts;
}

/**
 * Compose the message an answered set sends back.
 *
 * Written as the person would have typed it, because that is exactly what it
 * is — the agent reads a normal chat message and needs no parser. Numbered to
 * match the order asked, so a set answered out of order still reads in order.
 */
export function composeAnswer(questions: AskQuestion[], answers: (string | null)[]): string {
  return questions
    .map((q, i) => {
      const answer = answers[i];
      return `${String(i + 1)}. ${q.title}\n   ${answer ?? '(skipped)'}`;
    })
    .join('\n');
}

/** Whether every question has an answer — what gates submission. */
export function isComplete(questions: AskQuestion[], answers: (string | null)[]): boolean {
  return questions.every((_, i) => {
    const a = answers[i];
    return typeof a === 'string' && a.trim().length > 0;
  });
}
