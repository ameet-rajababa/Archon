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

export interface IssueComment {
  /** GitHub's node id. Only ever a React key; nothing resolves it. */
  id: string;
  /** Null for a deleted account — GitHub returns no author, not an empty one. */
  author: string | null;
  createdAt: string;
  body: string;
}

/**
 * One issue with enough of itself to be read without leaving the console.
 *
 * `body` and every comment body are raw markdown, rendered client-side. Not
 * GitHub's rendered HTML, and not an iframe of github.com — that was the first
 * idea and it cannot work, because github.com serves `x-frame-options: deny`.
 * Rendering the markdown ourselves is what makes an issue look like the rest
 * of the application instead of a hole cut into it.
 */
export interface GithubIssueDetail extends GithubIssue {
  body: string;
  author: string | null;
  createdAt: string;
  comments: IssueComment[];
  /** Comments past the page the server fetched. Shown as a count, not paged. */
  moreComments: number;
}

export interface IssuesResponse {
  issues: GithubIssue[];
  repo: string | null;
  reason: string | null;
}

export function listIssues(projectId: string): Promise<IssuesResponse> {
  return requestJson<IssuesResponse>(`/api/projects/${encodeURIComponent(projectId)}/issues`);
}

/**
 * One issue, read through the same proxy for the same reason. `issue` is null
 * whenever `reason` is set — including `no-such-issue`, which is a number
 * nobody has used rather than a failure of the read.
 */
export interface IssueDetailResponse {
  issue: GithubIssueDetail | null;
  repo: string | null;
  reason: string | null;
}

export function getIssue(projectId: string, number: number): Promise<IssueDetailResponse> {
  return requestJson<IssueDetailResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/issues/${String(number)}`
  );
}
