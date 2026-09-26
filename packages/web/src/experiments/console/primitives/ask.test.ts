import { describe, test, expect } from 'bun:test';
import {
  parseAskSpec,
  splitReply,
  composeAnswer,
  isComplete,
  toggleChoice,
  setCustomAnswer,
  type AskQuestion,
  type AskSpec,
} from './ask';

const SPEC = {
  questions: [
    {
      title: 'What is framework now?',
      evidence: 'Last updated Jul 20.',
      chip: 'rajababa-io/framework',
      options: [
        {
          label: 'Dead — archive it.',
          detail: 'Skills replaced it.',
          recommended: true,
          why: 'Two months cold.',
        },
        { label: 'Parked, not dead.' },
      ],
    },
  ],
};

const fenced = (json: unknown): string => '```ask\n' + JSON.stringify(json, null, 2) + '\n```';

/** Unwrap a parse expected to succeed, failing loudly rather than silently. */
const ok = (raw: string): AskSpec => {
  const result = parseAskSpec(raw);
  if (!result.ok) throw new Error(`expected a valid spec, got: ${result.reason}`);
  return result.spec;
};

/** The reason a parse expected to fail gave. */
const why = (raw: string): string => {
  const result = parseAskSpec(raw);
  if (result.ok) throw new Error('expected the spec to be rejected');
  return result.reason;
};

describe('parseAskSpec', () => {
  test('reads a well-formed spec', () => {
    const spec = ok(JSON.stringify(SPEC));
    expect(spec.questions).toHaveLength(1);
    const q = spec.questions[0];
    expect(q?.title).toBe('What is framework now?');
    expect(q?.chip).toBe('rajababa-io/framework');
    expect(q?.options[0]?.recommended).toBe(true);
    expect(q?.options[0]?.why).toBe('Two months cold.');
  });

  test('omits absent optional keys rather than setting them undefined', () => {
    expect(ok(JSON.stringify(SPEC)).questions[0]?.options[1]).toEqual({
      label: 'Parked, not dead.',
    });
  });

  test('allowOwn defaults to present-and-true by omission, and false is preserved', () => {
    expect('allowOwn' in (ok(JSON.stringify(SPEC)).questions[0] ?? {})).toBe(false);

    const noOwn = ok(JSON.stringify({ questions: [{ ...SPEC.questions[0], allowOwn: false }] }));
    expect(noOwn.questions[0]?.allowOwn).toBe(false);
  });

  // Every rejection names what is wrong and where. The reason is the product
  // here, not a by-product: it is what the console shows the block's author.
  test.each([
    ['not json', 'this is not json', /not valid JSON/],
    ['not an object', '"a string"', /must be a JSON object/],
    ['an array at the top level', '[]', /must be a JSON object/],
    ['no questions key', '{}', /missing `questions`/],
    ['empty questions', '{"questions":[]}', /`questions` is empty/],
    [
      'question with no title',
      '{"questions":[{"options":[{"label":"a"}]}]}',
      /question 1.*`title`/,
    ],
    [
      'question with a blank title',
      '{"questions":[{"title":"  ","options":[{"label":"a"}]}]}',
      /question 1.*`title`/,
    ],
    [
      'question with no options',
      '{"questions":[{"title":"t","options":[]}]}',
      /`options` is empty/,
    ],
    [
      'option with no label',
      '{"questions":[{"title":"t","options":[{"detail":"d"}]}]}',
      /question 1, option 1.*`label`/,
    ],
  ])('rejects %s with a located reason', (_name, raw, expected) => {
    expect(why(raw)).toMatch(expected);
  });

  test('locates the failure in the question that has it, not the first', () => {
    const raw = JSON.stringify({
      questions: [SPEC.questions[0], { title: 't', options: [{ label: 'a' }, { detail: 'd' }] }],
    });
    expect(why(raw)).toMatch(/question 2, option 2/);
  });

  // The failure this whole path was built for: an agent writing the schema from
  // memory. A bare "needs a title" sends it back to the docs that already
  // failed to prevent the mistake; naming the wrong key it actually wrote does
  // not.
  test('names the mistaken key when a plausible wrong one was used', () => {
    expect(why('{"questions":[{"question":"q?","options":[{"label":"a"}]}]}')).toContain(
      'saw `question`, the field is `title`'
    );
    expect(why('{"questions":[{"title":"t","options":[{"value":"a"}]}]}')).toContain(
      'saw `value`, the field is `label`'
    );
  });
});

describe('splitReply', () => {
  test('separates prose from an ask block, in order', () => {
    const parts = splitReply(`Here is the question.\n\n${fenced(SPEC)}\n\nAnswer when ready.`);
    expect(parts.map(p => p.kind)).toEqual(['markdown', 'ask', 'markdown']);
    expect(parts[0]).toEqual({ kind: 'markdown', text: 'Here is the question.\n' });
  });

  test('a reply with no ask block is one markdown part', () => {
    const parts = splitReply('Just talking.\n\nStill talking.');
    expect(parts).toEqual([{ kind: 'markdown', text: 'Just talking.\n\nStill talking.' }]);
  });

  test('handles several blocks in one reply', () => {
    const parts = splitReply(`${fenced(SPEC)}\nmiddle\n${fenced(SPEC)}`);
    expect(parts.map(p => p.kind)).toEqual(['ask', 'markdown', 'ask']);
  });

  // The degradation guarantees — a bad block must never eat the reply.
  test('an unterminated fence stays prose, and the rest of the reply survives', () => {
    const content = '```ask\n{"questions":[]}\nand then more text';
    const parts = splitReply(content);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.kind).toBe('markdown');
    expect(parts[0]).toMatchObject({ text: expect.stringContaining('and then more text') });
  });

  // A malformed block used to arrive as markdown, which is indistinguishable
  // from the intentional plain-text fallback on clients that cannot draw a
  // card. In the console that silence is the bug, so it gets its own part kind.
  test('a malformed block becomes an ask-error carrying the original text', () => {
    const content = '```ask\n{ broken json\n```';
    const parts = splitReply(content);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ kind: 'ask-error', text: content });
    expect(parts[0]).toMatchObject({ reason: expect.stringContaining('not valid JSON') });
  });

  test('prose around a malformed block is preserved and stays in order', () => {
    const parts = splitReply('Before.\n\n```ask\n{}\n```\n\nAfter.');
    expect(parts.map(p => p.kind)).toEqual(['markdown', 'ask-error', 'markdown']);
    expect(parts[2]).toMatchObject({ text: expect.stringContaining('After.') });
  });

  // Until the closing fence lands the block is not a block. Reporting it early
  // would make every question flash an error while it streams in.
  test('an unterminated malformed block is prose, not an error', () => {
    const parts = splitReply('```ask\n{ broken json');
    expect(parts.map(p => p.kind)).toEqual(['markdown']);
  });

  test('an ordinary code block is not mistaken for an ask block', () => {
    const content = '```json\n{"questions":[]}\n```';
    expect(splitReply(content)).toEqual([{ kind: 'markdown', text: content }]);
  });

  // Documenting the format means showing an ask fence inside a longer one. If
  // that example were read as a real card, every doc about ask blocks would be
  // corrupted by the thing it describes.
  test('an ask fence demonstrated inside a longer backtick fence stays code', () => {
    const content = ['````markdown', '```ask', JSON.stringify(SPEC), '```', '````'].join('\n');
    const parts = splitReply(content);
    expect(parts).toEqual([{ kind: 'markdown', text: content }]);
  });

  test('an ask fence inside a tilde fence stays code', () => {
    const content = ['~~~markdown', '```ask', JSON.stringify(SPEC), '```', '~~~'].join('\n');
    expect(splitReply(content)).toEqual([{ kind: 'markdown', text: content }]);
  });

  test('a real card after a code block that contained an example is still read', () => {
    const content = [
      '````markdown',
      '```ask',
      '{"questions":[]}',
      '```',
      '````',
      '',
      fenced(SPEC),
    ].join('\n');
    const parts = splitReply(content);
    expect(parts.map(p => p.kind)).toEqual(['markdown', 'ask']);
  });

  test('a longer ask fence is opened and closed at its own length', () => {
    const content = ['````ask', JSON.stringify(SPEC), '````'].join('\n');
    expect(splitReply(content).map(p => p.kind)).toEqual(['ask']);
  });

  test('a short fence does not close a longer ask fence', () => {
    // Unterminated at its own length, so it degrades to prose rather than
    // ending the card early at the three-backtick line.
    const content = ['````ask', JSON.stringify(SPEC), '```'].join('\n');
    const parts = splitReply(content);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.kind).toBe('markdown');
  });

  test('an unterminated ordinary fence leaves the rest as prose, not a card', () => {
    const content = ['```markdown', '```ask', '{"questions":[]}'].join('\n');
    const parts = splitReply(content);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.kind).toBe('markdown');
  });
});

describe('composeAnswer', () => {
  const questions: AskQuestion[] = [
    { title: 'First?', options: [{ label: 'a' }] },
    { title: 'Second?', options: [{ label: 'b' }] },
  ];

  test('numbers the answers in the order asked', () => {
    expect(composeAnswer(questions, [['Yes'], ['No']])).toBe(
      '1. First?\n   Yes\n2. Second?\n   No'
    );
  });

  test('marks an unanswered question rather than dropping it', () => {
    expect(composeAnswer(questions, [['Yes'], null])).toContain('(skipped)');
  });

  test('writes several choices one per line, so a comma in an option cannot be read as a separator', () => {
    const multi: AskQuestion[] = [
      {
        title: 'Which apply?',
        multi: true,
        options: [{ label: 'a, with a comma' }, { label: 'b' }],
      },
    ];
    expect(composeAnswer(multi, [['a, with a comma', 'b']])).toBe(
      '1. Which apply?\n   a, with a comma\n   b'
    );
  });
});

describe('isComplete', () => {
  const questions: AskQuestion[] = [
    { title: 'First?', options: [{ label: 'a' }] },
    { title: 'Second?', options: [{ label: 'b' }] },
  ];

  test('true only when every question has a non-blank answer', () => {
    expect(isComplete(questions, [['a'], ['b']])).toBe(true);
    expect(isComplete(questions, [['a'], null])).toBe(false);
    expect(isComplete(questions, [['a'], ['   ']])).toBe(false);
    expect(isComplete(questions, [['a'], []])).toBe(false);
    expect(isComplete(questions, [])).toBe(false);
  });
});

describe('toggleChoice', () => {
  test('a single-answer question replaces whatever was there', () => {
    expect(toggleChoice(null, 'a', false)).toEqual(['a']);
    expect(toggleChoice(['a'], 'b', false)).toEqual(['b']);
    // Re-picking the same option leaves it picked rather than clearing it —
    // a question that demands an answer should never be emptied by a click.
    expect(toggleChoice(['a'], 'a', false)).toEqual(['a']);
  });

  test('a multi-answer question adds, and removes on a second click', () => {
    expect(toggleChoice(null, 'a', true)).toEqual(['a']);
    expect(toggleChoice(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggleChoice(['a', 'b'], 'a', true)).toEqual(['b']);
    expect(toggleChoice(['a'], 'a', true)).toEqual([]);
  });

  test('keeps the order options were chosen in', () => {
    expect(toggleChoice(['c', 'a'], 'b', true)).toEqual(['c', 'a', 'b']);
  });
});

describe('setCustomAnswer', () => {
  const options = [{ label: 'a' }, { label: 'b' }];

  test('a single-answer question is replaced outright', () => {
    expect(setCustomAnswer(null, 'typed', options, false)).toEqual(['typed']);
    expect(setCustomAnswer(['old'], 'new', options, false)).toEqual(['new']);
  });

  // The bug this exists to prevent: toggling left both, the card displayed the
  // stale one, and composeAnswer submitted the pair.
  test('editing free text replaces the old text, it does not add to it', () => {
    expect(setCustomAnswer(['old'], 'new', options, true)).toEqual(['new']);
  });

  test('chosen options survive alongside the custom text, in order', () => {
    expect(setCustomAnswer(['a', 'old', 'b'], 'new', options, true)).toEqual(['a', 'b', 'new']);
  });

  test('clearing the text leaves the chosen options behind', () => {
    expect(setCustomAnswer(['a', 'old'], '', options, true)).toEqual(['a']);
  });
});

describe('parseAskSpec — multi', () => {
  test('multi is preserved when set, and absent otherwise', () => {
    const on = ok('{"questions":[{"title":"t","multi":true,"options":[{"label":"a"}]}]}');
    expect(on.questions[0]?.multi).toBe(true);
    const off = ok('{"questions":[{"title":"t","options":[{"label":"a"}]}]}');
    expect('multi' in (off.questions[0] ?? {})).toBe(false);
  });
});
