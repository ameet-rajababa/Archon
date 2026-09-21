/**
 * Plain-English descriptions of what the agent is doing right now.
 *
 * The indicator used to show the raw tool name — `Bash`, `Read`, `Grep` — which
 * tells you the mechanism and not the work. This turns the tool name AND its
 * input into the sentence a person would say: "Running the tests",
 * "Reading tokens.css", "Searching for AREA_LABELS".
 *
 * Deliberately not playful. Cute invented verbs ("combobulating") are a way of
 * filling silence without saying anything; the point here is that the line is
 * TRUE and specific, so a static screen can only mean the conversation is over
 * or it is your turn.
 *
 * Pure and side-effect free so it can be tested without a DOM.
 */

/** Last path segment, so a description stays short: `a/b/tokens.css` → `tokens.css`. */
function baseName(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const clean = raw.split('?')[0]?.replace(/\/+$/, '') ?? '';
  const last = clean.split('/').pop();
  return last !== undefined && last !== '' ? last : null;
}

function str(input: Record<string, unknown> | undefined, key: string): string | null {
  const v = input?.[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** Shell commands are the least self-describing tool, so they get their own read. */
function describeCommand(command: string): string {
  const c = command.toLowerCase();
  const has = (...needles: string[]): boolean => needles.some(n => c.includes(n));

  // Ordered: the more specific reading wins. `bun run build:web` contains both
  // "run" and "build", and "Building" is the useful half.
  if (has('type-check', 'typecheck', 'tsc --noemit', 'tsc -p')) return 'Checking types';
  if (has(' test', 'test ', 'vitest', 'jest', 'playwright')) return 'Running the tests';
  if (has('lint', 'eslint', 'prettier')) return 'Checking style';
  if (has('build')) return 'Building';
  if (has('git commit')) return 'Committing';
  if (has('git push')) return 'Pushing';
  if (has('git diff', 'git log', 'git status', 'git show')) return 'Reading the history';
  if (has('psql', 'sqlite3')) return 'Querying the database';
  if (has('docker')) return 'Talking to Docker';
  if (has('curl', 'wget', 'http')) return 'Calling an API';
  if (has('gh ')) return 'Talking to GitHub';
  if (has('npm install', 'bun install', 'pnpm install', 'yarn add')) return 'Installing packages';
  if (has('grep', 'rg ', 'find ', 'ls ')) return 'Looking through files';
  if (has('deploy')) return 'Deploying';

  // Nothing recognized: name the program, which is still better than "Bash".
  const first = command.trim().split(/\s+/)[0];
  const program = first === undefined ? null : baseName(first);
  return program === null ? 'Running a command' : `Running ${program}`;
}

/**
 * One short line describing the tool call. Never empty — an unknown tool still
 * produces something honest rather than nothing.
 */
export function describeActivity(name: string, input?: Record<string, unknown>): string {
  const tool = name.trim();

  switch (tool) {
    case 'Read': {
      const f = baseName(str(input, 'file_path') ?? str(input, 'path'));
      return f === null ? 'Reading a file' : `Reading ${f}`;
    }
    case 'Write': {
      const f = baseName(str(input, 'file_path') ?? str(input, 'path'));
      return f === null ? 'Writing a file' : `Writing ${f}`;
    }
    case 'Edit':
    case 'NotebookEdit': {
      const f = baseName(str(input, 'file_path') ?? str(input, 'notebook_path'));
      return f === null ? 'Editing a file' : `Editing ${f}`;
    }
    case 'Bash': {
      const cmd = str(input, 'command');
      return cmd === null ? 'Running a command' : describeCommand(cmd);
    }
    case 'Grep': {
      const p = str(input, 'pattern');
      return p === null ? 'Searching the code' : `Searching for ${p.slice(0, 32)}`;
    }
    case 'Glob':
      return 'Looking for files';
    case 'Task':
      return 'Handing off to a subagent';
    case 'WebSearch':
      return 'Searching the web';
    case 'WebFetch': {
      const url = str(input, 'url');
      if (url === null) return 'Reading a web page';
      // Hostname without a URL parse: the input is not guaranteed to be valid.
      const host = url.replace(/^[a-z]+:\/\//i, '').split('/')[0];
      return host === undefined || host === '' ? 'Reading a web page' : `Reading ${host}`;
    }
    case 'TodoWrite':
      return 'Updating its plan';
    default:
      break;
  }

  // MCP tools arrive as `mcp__<server>__<verb>`; the server is the useful half.
  const mcp = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(tool);
  if (mcp !== null) {
    const server = (mcp[1] ?? '').replace(/[-_]+/g, ' ').trim();
    return server === '' ? 'Using a tool' : `Using ${server}`;
  }

  // Unknown tool: split camelCase / snake_case into words rather than guess.
  const words = tool
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return words === '' ? 'Working' : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** `9s`, `2m 14s`, `1h 3m` — short enough to sit inside the indicator. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${String(total)}s`;
  const m = Math.floor(total / 60);
  if (m < 60) return `${String(m)}m ${String(total % 60)}s`;
  return `${String(Math.floor(m / 60))}h ${String(m % 60)}m`;
}

/**
 * One row of the expanded trace: a verb and what it acted on.
 *
 * Deliberately narrower than {@link describeActivity}. That writes the sentence
 * shown on the strip itself, where one line stands for the whole turn; this
 * writes the log of steps underneath it, where a column of sentences reads
 * worse than a column of `read  ChatPage.tsx`. Same inputs, different job.
 *
 * `target` may be empty — a tool with nothing worth naming gets the verb alone
 * rather than an invented object.
 */
export interface TraceLine {
  verb: string;
  target: string;
}

export function traceLine(name: string, input?: Record<string, unknown>): TraceLine {
  const tool = name.trim();

  switch (tool) {
    case 'Read':
      return {
        verb: 'read',
        target: baseName(str(input, 'file_path') ?? str(input, 'path')) ?? '',
      };
    case 'Write':
      return {
        verb: 'write',
        target: baseName(str(input, 'file_path') ?? str(input, 'path')) ?? '',
      };
    case 'Edit':
      return { verb: 'edit', target: baseName(str(input, 'file_path')) ?? '' };
    case 'NotebookEdit':
      return { verb: 'edit', target: baseName(str(input, 'notebook_path')) ?? '' };
    case 'Bash': {
      // The command itself, not a basename: `bun run lint` is the useful half,
      // and `lint` alone would read as a file.
      const cmd = str(input, 'command') ?? '';
      return { verb: 'run', target: cmd.replace(/\s+/g, ' ').slice(0, 64) };
    }
    case 'Grep': {
      const pattern = str(input, 'pattern') ?? '';
      const path = str(input, 'path');
      const where = path === null ? '' : ` in ${path}`;
      return { verb: 'grep', target: `${pattern.slice(0, 40)}${where}` };
    }
    case 'Glob':
      return { verb: 'glob', target: str(input, 'pattern') ?? '' };
    case 'Task':
      return { verb: 'task', target: str(input, 'description') ?? '' };
    case 'WebSearch':
      return { verb: 'search', target: str(input, 'query')?.slice(0, 48) ?? '' };
    case 'WebFetch':
      return { verb: 'fetch', target: str(input, 'url')?.replace(/^[a-z]+:\/\//i, '') ?? '' };
    case 'TodoWrite':
      return { verb: 'plan', target: '' };
    default:
      break;
  }

  // `mcp__<server>__<verb>` — both halves are worth showing here, unlike the
  // strip line, which has room for only the server.
  const mcp = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(tool);
  if (mcp !== null) {
    return { verb: (mcp[1] ?? 'mcp').replace(/[-_]+/g, ' '), target: mcp[2] ?? '' };
  }

  return { verb: tool.toLowerCase(), target: '' };
}
