import { describe, expect, test } from 'bun:test';
import { contextWindowFor } from './context-window';

describe('contextWindowFor', () => {
  test('the current generation is a million, not two hundred thousand', () => {
    // Written from memory, this table put every Claude model at 200k and read
    // a 567k conversation as 283% full on a model with a 1M window.
    expect(contextWindowFor('claude-opus-5')).toBe(1_000_000);
    expect(contextWindowFor('claude-sonnet-5')).toBe(1_000_000);
    expect(contextWindowFor('claude-fable-5')).toBe(1_000_000);
  });

  test('a 200k model is still 200k', () => {
    expect(contextWindowFor('claude-haiku-4-5')).toBe(200_000);
    expect(contextWindowFor('claude-sonnet-4-5')).toBe(200_000);
  });

  test('a specific id beats the family it belongs to', () => {
    expect(contextWindowFor('claude-sonnet-4-6-20251114')).toBe(1_000_000);
  });

  test('there is no family-level guess — an unlisted model has no window', () => {
    // `claude-opus` must NOT stand in for "every Opus": that is exactly how a
    // retired figure became the denominator for a newer model.
    expect(contextWindowFor('claude-opus-9')).toBeNull();
    expect(contextWindowFor('some-new-model')).toBeNull();
    expect(contextWindowFor(undefined)).toBeNull();
    expect(contextWindowFor('')).toBeNull();
  });
});
