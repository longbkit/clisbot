import {
  IssueCommentPayloadSchema,
  IssuesPayloadSchema,
  PullRequestPayloadSchema,
  PullRequestReviewCommentPayloadSchema,
  PullRequestReviewPayloadSchema,
} from "../../auth/github-events.js";
import type { NormalizedGitHubEvent } from "../../auth/github-events.js";

export const GITHUB_SEMANTIC_TRIGGER_EVENT_NAMES = [
  "github.issue_created",
  "github.pull_request_created",
  "github.issue_comment_created",
  "github.pull_request_comment_created",
  "github.issue_label_added",
  "github.pull_request_label_added",
] as const;

export type GitHubSemanticEvent = (typeof GITHUB_SEMANTIC_TRIGGER_EVENT_NAMES)[number];

export const GITHUB_TRIGGER_EVENT_NAMES = [
  "github.issue_comment",
  "github.issues",
  "github.pull_request_review",
  "github.pull_request_review_comment",
  "github.push",
  ...GITHUB_SEMANTIC_TRIGGER_EVENT_NAMES,
] as const;

export interface GitHubClassifiedEvent {
  readonly semanticEvent: GitHubSemanticEvent | undefined;
  readonly actor: string;
  readonly text: string;
  readonly labels: readonly string[];
  readonly changedLabel: string | undefined;
  readonly item: GitHubClassifiedItem | null;
}

export interface GitHubClassifiedItem {
  readonly type: "issue" | "pull_request";
  readonly number: number | null;
  readonly title: string | null;
  readonly body: string | null;
  readonly url: string | null;
  readonly author: { readonly login: string } | null;
}

/** The sole owner of GitHub webhook action and item interpretation. */
export function classifyGitHubEvent(event: NormalizedGitHubEvent): GitHubClassifiedEvent {
  if (event.type === "issues") return classifyIssue(event);
  if (event.type === "pull_request") return classifyPullRequest(event);
  if (event.type === "issue_comment") return classifyIssueComment(event);
  if (event.type === "pull_request_review") return classifyReview(event);
  if (event.type === "pull_request_review_comment") return classifyReviewComment(event);
  return emptyClassification();
}

function classifyIssue(event: NormalizedGitHubEvent): GitHubClassifiedEvent {
  const payload = IssuesPayloadSchema.parse(event.payload);
  const item = payload.issue === undefined ? null : itemFor("issue", payload.issue);
  return {
    semanticEvent: issueSemanticEvent(payload.action),
    actor: payload.sender?.login ?? "",
    text: textFor(item),
    labels: labelsFor(payload.issue?.labels),
    changedLabel: payload.action === "labeled" ? payload.label?.name : undefined,
    item,
  };
}

function classifyPullRequest(event: NormalizedGitHubEvent): GitHubClassifiedEvent {
  const payload = PullRequestPayloadSchema.parse(event.payload);
  const item =
    payload.pull_request === undefined ? null : itemFor("pull_request", payload.pull_request);
  return {
    semanticEvent: pullRequestSemanticEvent(payload.action),
    actor: payload.sender?.login ?? "",
    text: textFor(item),
    labels: labelsFor(payload.pull_request?.labels),
    changedLabel: payload.action === "labeled" ? payload.label?.name : undefined,
    item,
  };
}

function classifyIssueComment(event: NormalizedGitHubEvent): GitHubClassifiedEvent {
  const payload = IssueCommentPayloadSchema.parse(event.payload);
  const isPullRequest = payload.issue?.pull_request !== undefined;
  return {
    semanticEvent: commentSemanticEvent(payload.action, isPullRequest),
    actor: payload.sender?.login ?? payload.comment?.user?.login ?? "",
    text: payload.comment?.body ?? "",
    labels: labelsFor(payload.issue?.labels),
    changedLabel: undefined,
    item:
      payload.issue === undefined
        ? null
        : itemFor(isPullRequest ? "pull_request" : "issue", payload.issue),
  };
}

function classifyReview(event: NormalizedGitHubEvent): GitHubClassifiedEvent {
  const payload = PullRequestReviewPayloadSchema.parse(event.payload);
  return {
    ...emptyClassification(),
    actor: payload.sender?.login ?? payload.review?.user?.login ?? "",
    text: payload.review?.body ?? "",
    labels: labelsFor(payload.pull_request?.labels),
    item: payload.pull_request === undefined ? null : itemFor("pull_request", payload.pull_request),
  };
}

function classifyReviewComment(event: NormalizedGitHubEvent): GitHubClassifiedEvent {
  const payload = PullRequestReviewCommentPayloadSchema.parse(event.payload);
  return {
    ...emptyClassification(),
    actor: payload.sender?.login ?? payload.comment?.user?.login ?? "",
    text: payload.comment?.body ?? "",
    labels: labelsFor(payload.pull_request?.labels),
    item: payload.pull_request === undefined ? null : itemFor("pull_request", payload.pull_request),
  };
}

function emptyClassification(): GitHubClassifiedEvent {
  return {
    semanticEvent: undefined,
    actor: "",
    text: "",
    labels: [],
    changedLabel: undefined,
    item: null,
  };
}

function issueSemanticEvent(action: string | undefined): GitHubSemanticEvent | undefined {
  if (action === "opened") return "github.issue_created";
  if (action === "labeled") return "github.issue_label_added";
  return undefined;
}

function pullRequestSemanticEvent(action: string | undefined): GitHubSemanticEvent | undefined {
  if (action === "opened") return "github.pull_request_created";
  if (action === "labeled") return "github.pull_request_label_added";
  return undefined;
}

function commentSemanticEvent(
  action: string | undefined,
  isPullRequest: boolean,
): GitHubSemanticEvent | undefined {
  if (action !== "created") return undefined;
  return isPullRequest ? "github.pull_request_comment_created" : "github.issue_comment_created";
}

function itemFor(
  type: GitHubClassifiedItem["type"],
  item: {
    number?: number | undefined;
    title?: string | undefined;
    body?: string | undefined;
    html_url?: string | undefined;
    user?: { login?: string | undefined } | undefined;
  },
): GitHubClassifiedItem {
  return {
    type,
    number: item.number ?? null,
    title: item.title ?? null,
    body: item.body ?? null,
    url: item.html_url ?? null,
    author: item.user?.login === undefined ? null : { login: item.user.login },
  };
}

function textFor(item: GitHubClassifiedItem | null): string {
  return [item?.title ?? "", item?.body ?? ""].filter((value) => value.length > 0).join("\n");
}

function labelsFor(
  labels: readonly { name?: string | undefined }[] | undefined,
): readonly string[] {
  return labels?.flatMap((label) => (label.name === undefined ? [] : [label.name])) ?? [];
}
