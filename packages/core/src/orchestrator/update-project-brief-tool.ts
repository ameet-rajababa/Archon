import { defineNativeToolInputSchema, type NativeTool } from '@archon/providers/types';
import { createLogger } from '@archon/paths';
import { getCodebasePresentation, updateCodebasePresentation } from '../db/codebases';

const log = createLogger('orchestrator.update_project_brief');

export interface ProjectBriefContext {
  /** The project (codebase) this chat is scoped to. */
  codebaseId: string;
}

/** The three parts, as stored under `presentation.brief`. */
export interface Brief {
  why: string;
  doing: string;
  where: string;
  updatedAt: number | null;
}

const EMPTY: Brief = { why: '', doing: '', where: '', updatedAt: null };

function readBrief(presentation: Record<string, unknown> | null): Brief {
  const raw = presentation?.brief;
  if (typeof raw !== 'object' || raw === null) return EMPTY;
  const b = raw as Partial<Brief>;
  return {
    why: typeof b.why === 'string' ? b.why : '',
    doing: typeof b.doing === 'string' ? b.doing : '',
    where: typeof b.where === 'string' ? b.where : '',
    updatedAt: typeof b.updatedAt === 'number' ? b.updatedAt : null,
  };
}

/** Same three fields, ignoring the timestamp. */
export function sameText(a: Brief, b: Brief): boolean {
  return a.why === b.why && a.doing === b.doing && a.where === b.where;
}

export interface BriefPatch {
  why?: unknown;
  doing?: unknown;
  where?: unknown;
}

/**
 * Merge a call into the stored brief.
 *
 * Pure, and separate from the handler, because the rule worth testing has
 * nothing to do with the database: an omitted field KEEPS its value, and text
 * identical to what is stored does not move `updatedAt`.
 */
export function mergeBrief(before: Brief, patch: BriefPatch, now: number): Brief {
  const str = (v: unknown): string | null => (typeof v === 'string' ? v.trim() : null);
  const next: Brief = {
    why: str(patch.why) ?? before.why,
    doing: str(patch.doing) ?? before.doing,
    where: str(patch.where) ?? before.where,
    updatedAt: before.updatedAt,
  };
  if (!sameText(before, next)) next.updatedAt = now;
  return next;
}

export function isBlank(b: Brief): boolean {
  return b.why === '' && b.doing === '' && b.where === '';
}

const INPUT_SCHEMA = defineNativeToolInputSchema({
  properties: {
    why: {
      kind: 'string',
      description:
        'Why this project exists. The standing answer, which rarely changes — leave it out unless it is actually wrong.',
    },
    doing: {
      kind: 'string',
      description: 'What is being worked on now. One or two sentences.',
    },
    where: {
      kind: 'string',
      description:
        'Where it has got to — what is done, what is open, what is blocked. The part that goes stale fastest.',
    },
  },
  required: [],
});

/**
 * Lets the agent keep a PROJECT's brief current.
 *
 * Why a tool and not a nightly job that reads the repo: "where it has got to"
 * is a judgement. A model reading commits back can say what changed; only the
 * agent that did the work knows whether it mattered, or what is still open.
 *
 * Call it when a piece of work LANDS — not every turn, and not when a question
 * was merely answered. Two reasons. The brief is read by someone arriving
 * cold, so churn makes it worse, not fresher. And the card shows "written 4m
 * ago", which is the only thing that stops a stale brief being believed: if
 * every turn bumped it, the timestamp would say "fresh" about text nobody had
 * revisited.
 *
 * That is enforced, not just asked for. A call whose three fields match what
 * is already stored leaves `updatedAt` alone — an agent that reflexively
 * rewrites the same words cannot make a stale brief look new.
 *
 * Fields are OMITTED to keep them, not blanked. `why` in particular usually
 * survives a rewrite of the other two.
 */
export function buildProjectBriefTool(ctx: ProjectBriefContext): NativeTool {
  return {
    name: 'update_project_brief',
    description:
      "Rewrite this project's brief — `why` it exists, what we are `doing`, and `where` it has got to — so someone arriving cold can see the state of the project. Call it when a piece of work LANDS (a PR opened, a fix shipped, a direction abandoned), NOT every turn and not for a question you merely answered. Omit a field to leave it unchanged; `why` rarely needs rewriting. Write plainly, in full sentences, and say what is actually true now — including what is broken or unfinished.",
    inputSchema: INPUT_SCHEMA,
    handler: async (input): Promise<string> => {
      try {
        const current = await getCodebasePresentation(ctx.codebaseId);
        if (current === null) return 'update_project_brief: this project no longer exists.';
        const before = readBrief(current.presentation);

        const next = mergeBrief(before, input, Date.now());

        if (isBlank(next)) {
          return 'update_project_brief: nothing to write — give at least one of why/doing/where.';
        }
        if (sameText(before, next)) {
          return 'update_project_brief: unchanged, so the "written" time was left alone.';
        }

        await updateCodebasePresentation(ctx.codebaseId, { brief: next });
        const changed = (['why', 'doing', 'where'] as const).filter(k => before[k] !== next[k]);
        log.info({ codebaseId: ctx.codebaseId, changed }, 'project_brief.updated');
        return `update_project_brief: updated ${changed.join(', ')}.`;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error({ err: e, codebaseId: ctx.codebaseId }, 'project_brief.failed');
        return `update_project_brief error: ${msg}`;
      }
    },
  };
}
