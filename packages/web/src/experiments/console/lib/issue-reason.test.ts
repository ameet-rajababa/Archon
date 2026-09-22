import { describe, test, expect } from 'bun:test';
import { issueReasonText } from './issue-reason';

describe('issueReasonText', () => {
  test('translates the reasons the server decides itself', () => {
    expect(issueReasonText('no-repository')).toBe(
      'This project has no repository, so there is nothing to read.'
    );
    expect(issueReasonText('not-github')).toBe('This project’s remote is not GitHub.');
    expect(issueReasonText('no-token')).toBe('No GitHub token is configured on the server.');
    expect(issueReasonText('unreachable')).toBe('GitHub could not be reached.');
  });

  test('App mode and PAT mode blame different things for a missing token', () => {
    expect(issueReasonText('no-token')).toContain('No GitHub token is configured');
    expect(issueReasonText('app-not-installed')).toContain('GitHub App is not installed');
  });

  test('a rejected token names the token, not the number', () => {
    const text = issueReasonText('github-401');
    expect(text).not.toBe('github-401');
    expect(text).toContain('GITHUB_TOKEN');
  });

  test('403 and 404 each say who can act on them', () => {
    expect(issueReasonText('github-403')).toContain('rate limit');
    expect(issueReasonText('github-404')).toContain('private repository');
  });

  test('an unnamed 4xx still reads as a sentence', () => {
    expect(issueReasonText('github-422')).toBe('GitHub refused the request (HTTP 422).');
  });

  test('a 5xx says it is GitHub’s side', () => {
    expect(issueReasonText('github-503')).toContain('GitHub is having trouble (HTTP 503)');
  });

  test('GitHub’s own GraphQL message passes through unchanged', () => {
    const message = 'Could not resolve to a Repository with the name ‘x/y’.';
    expect(issueReasonText(message)).toBe(message);
  });

  test('a reason that only looks like a status code is not rewritten', () => {
    expect(issueReasonText('github-40')).toBe('github-40');
    expect(issueReasonText('github-401-ish')).toBe('github-401-ish');
  });
});
