import { describe, test, expect } from 'bun:test';
import {
  parseAskSpec,
  splitReply,
  composeAnswer,
  isComplete,
  usesListView,
  type AskQuestion,
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

describe('parseAskSpec', () => {
  test('reads a well-formed spec', () => {
    const spec = parseAskSpec(JSON.stringify(SPEC));
    expect(spec?.questions).toHaveLength(1);
    const q = spec?.questions[0];
    expect(q?.title).toBe('What is framework now?');
    expect(q?.chip).toBe('rajababa-io/framework');
    expect(q?.options[0]?.recommended).toBe(true);
    expect(q?.options[0]?.why).toBe('Two months cold.');
  });

  test('omits absent optional keys rather than setting them undefined', () => {
    const spec = parseAskSpec(JSON.stringify(SPEC));
    const plain = spec?.questions[0]?.options[1];
    expect(plain).toEqual({ label: 'Parked, not dead.' });
  });

  test('allowOwn defaults to present-and-true by omission, and false is preserved', () => {
    const withOwn = parseAskSpec(JSON.stringify(SPEC));
    expect('allowOwn' in (withOwn?.questions[0] ?? {})).toBe(false);

    const noOwn = parseAskSpec(
      JSON.stringify({ questions: [{ ...SPEC.questions[0], allowOwn: false }] })
    );
    expect(noOwn?.questions[0]?.allowOwn).toBe(false);
  });

  // Every rejection path returns null so the caller can fall back to code.
  test.each([
    ['not json', 'this is not json'],
    ['not an object', '"a string"'],
    ['no questions key', '{}'],
    ['empty questions', '{"questions":[]}'],
    ['question with no title', '{"questions":[{"options":[{"label":"a"}]}]}'],
    ['question with a blank title', '{"questions":[{"title":"  ","options":[{"label":"a"}]}]}'],
    ['question with no options', '{"questions":[{"title":"t","options":[]}]}'],
    ['option with no label', '{"questions":[{"title":"t","options":[{"detail":"d"}]}]}'],
  ])('rejects %s', (_name, raw) => {
    expect(parseAskSpec(raw)).toBeNull();
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

  test('a malformed block is kept verbatim so it renders as readable code', () => {
    const content = '```ask\n{ broken json\n```';
    const parts = splitReply(content);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ kind: 'markdown', text: content });
  });

  test('an ordinary code block is not mistaken for an ask block', () => {
    const content = '```json\n{"questions":[]}\n```';
    expect(splitReply(content)).toEqual([{ kind: 'markdown', text: content }]);
  });
});

describe('composeAnswer', () => {
  const questions: AskQuestion[] = [
    { title: 'First?', options: [{ label: 'a' }] },
    { title: 'Second?', options: [{ label: 'b' }] },
  ];

  test('numbers the answers in the order asked', () => {
    expect(composeAnswer(questions, ['Yes', 'No'])).toBe('1. First?\n   Yes\n2. Second?\n   No');
  });

  test('marks an unanswered question rather than dropping it', () => {
    expect(composeAnswer(questions, ['Yes', null])).toContain('(skipped)');
  });
});

describe('isComplete', () => {
  const questions: AskQuestion[] = [
    { title: 'First?', options: [{ label: 'a' }] },
    { title: 'Second?', options: [{ label: 'b' }] },
  ];

  test('true only when every question has a non-blank answer', () => {
    expect(isComplete(questions, ['a', 'b'])).toBe(true);
    expect(isComplete(questions, ['a', null])).toBe(false);
    expect(isComplete(questions, ['a', '   '])).toBe(false);
    expect(isComplete(questions, [])).toBe(false);
  });
});

describe('usesListView', () => {
  test('a handful of questions keeps the pager', () => {
    expect(usesListView(1)).toBe(false);
    expect(usesListView(5)).toBe(false);
  });

  test('past five it switches to a stacked list', () => {
    expect(usesListView(6)).toBe(true);
    expect(usesListView(20)).toBe(true);
  });
});
