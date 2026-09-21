import { describe, expect, test } from 'bun:test';
import { contextWindowFor } from './context-window';

describe('contextWindowFor', () => {
  test('a specific id beats the family it belongs to', () => {
    expect(contextWindowFor('claude-sonnet-4-5-20250929')).toBe(200_000);
    expect(contextWindowFor('gpt-5.5')).toBe(400_000);
  });

  test('an unknown model has no window — never a default', () => {
    // A default here would be read as a fact, and it decides when a
    // conversation gets abandoned.
    expect(contextWindowFor('some-new-model')).toBeNull();
    expect(contextWindowFor(undefined)).toBeNull();
    expect(contextWindowFor('')).toBeNull();
  });
});
