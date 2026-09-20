/**
 * A project's GitHub issues, read through the server.
 *
 * The browser cannot call GitHub directly for a private repo and a token does
 * not belong in the browser, so `/api/projects/:id/issues` proxies it.
 *
 * `reason` is how a legitimately empty board explains itself: a folder-kind
 * project with no repository, a non-GitHub remote, a missing token, or GitHub
 * being unreachable are all "no issues" and only one of them is a problem. An
 * empty board that cannot say why reads as "you have no issues", which is a
 * different and wrong statement.
 */
import { requestJson } from '../lib/http';

export interface GithubIssue {
  number: number;
  title: string;
  /**
   * GitHub's own value, passed through. Not narrowed to a union: the server is
   * a thin passthrough, and a value GitHub adds should reach the client rather
   * than be silently mistyped as one of two.
   */
  state: string;
  stateReason: string | null;
  url: string;
  updatedAt: string;
  /** The GitHub issue TYPE (Task / Bug / Feature), not a label. */
  type: string | null;
  labels: { name: string; color: string }[];
  assignees: string[];
  /** An open PR that closes this issue — the difference between todo and review. */
  openPr: boolean;
}

export interface IssuesResponse {
  issues: GithubIssue[];
  repo: string | null;
  reason: string | null;
}

export function listIssues(projectId: string): Promise<IssuesResponse> {
  return requestJson<IssuesResponse>(`/api/projects/${encodeURIComponent(projectId)}/issues`);
}
