import { describe, expect, test } from 'bun:test';
import { describeActivity, formatElapsed } from './activity';

describe('describeActivity', () => {
  test('names the file, not the tool', () => {
    expect(describeActivity('Read', { file_path: 'packages/web/src/theme/tokens.css' })).toBe(
      'Reading tokens.css'
    );
    expect(describeActivity('Edit', { file_path: '/a/b/ChatPage.tsx' })).toBe(
      'Editing ChatPage.tsx'
    );
  });

  test('reads the shell command rather than saying "Bash"', () => {
    const cases: [string, string][] = [
      ['bun --filter @archon/web test', 'Running the tests'],
      ['bun run build:web', 'Building'],
      ['bun --filter @archon/web type-check', 'Checking types'],
      ['git commit -m x', 'Committing'],
      ['psql -h postgres -c "select 1"', 'Querying the database'],
      ['gh pr list', 'Talking to GitHub'],
      ['./deploy-console.sh', 'Deploying'],
    ];
    for (const [command, expected] of cases) {
      expect(describeActivity('Bash', { command })).toBe(expected);
    }
  });

  test('a specific reading beats a generic one when both match', () => {
    // contains "run" and "build"; "Building" is the useful half
    expect(describeActivity('Bash', { command: 'bun run build' })).toBe('Building');
    // contains "build" inside a path but is really a test run
    expect(describeActivity('Bash', { command: 'bun test src/build.test.ts' })).toBe(
      'Running the tests'
    );
  });

  test('falls back to the program name, never to the tool name', () => {
    expect(describeActivity('Bash', { command: '/usr/local/bin/frobnicate --x' })).toBe(
      'Running frobnicate'
    );
  });

  test('quotes what is being searched for', () => {
    expect(describeActivity('Grep', { pattern: 'AREA_LABELS' })).toBe('Searching for AREA_LABELS');
  });

  test('web tools name the host', () => {
    expect(describeActivity('WebFetch', { url: 'https://linear.app/docs/x' })).toBe(
      'Reading linear.app'
    );
    expect(describeActivity('WebSearch', {})).toBe('Searching the web');
  });

  test('MCP tools name the server', () => {
    expect(describeActivity('mcp__archon__manage_run')).toBe('Using archon');
    expect(describeActivity('mcp__workspace-ameet__create_doc')).toBe('Using workspace ameet');
  });

  test('an unknown tool still says something true', () => {
    expect(describeActivity('SomeNewTool')).toBe('Some new tool');
    expect(describeActivity('')).toBe('Working');
  });

  test('missing or malformed input never produces an empty line', () => {
    for (const name of ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'WebFetch']) {
      expect(describeActivity(name, {}).length).toBeGreaterThan(0);
      expect(describeActivity(name, { file_path: 42 as unknown as string }).length).toBeGreaterThan(
        0
      );
    }
  });
});

describe('formatElapsed', () => {
  test('reads as a duration a person would say', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(9_400)).toBe('9s');
    expect(formatElapsed(134_000)).toBe('2m 14s');
    expect(formatElapsed(3_780_000)).toBe('1h 3m');
  });

  test('never renders a negative clock', () => {
    expect(formatElapsed(-5_000)).toBe('0s');
  });
});
