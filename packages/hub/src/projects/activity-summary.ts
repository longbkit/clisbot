import { z } from "zod";
import { reportFailure } from "../failures/index.js";
import {
  IssueCommentPayloadSchema,
  IssuesPayloadSchema,
  NormalizedGitHubEventSchema,
  PullRequestReviewCommentPayloadSchema,
  PullRequestReviewPayloadSchema,
  PushPayloadSchema,
  readGitHubTriggerUrl,
} from "../auth/github-events.js";
import { NormalizedDiscordMessageEventSchema } from "../triggers/discord/events.js";
import { NormalizedSlackMentionEventSchema } from "../triggers/slack/events.js";
import { NormalizedLinearEventSchema } from "../triggers/linear/events.js";
import { classifyGitHubEvent } from "../triggers/github/classification.js";

export interface TriggerSummary {
  provider: "github" | "slack" | "discord" | "linear" | "manual";
  headline: string;
  actor: string | null;
  externalUrl: string | null;
}

const ManualTriggerPayloadSchema = z
  .object({ trigger: z.string().optional(), actor: z.string().optional() })
  .passthrough();

/**
 * Turns a trigger's raw provider payload into the one line a human needs to recognise
 * the event — this is the only place that reads provider payload shapes for display;
 * everywhere else treats a trigger as an opaque id.
 */
export function summarizeTrigger(source: string, payload: unknown): TriggerSummary {
  const [provider] = source.split(".");
  if (provider === "github") return summarizeGitHub(payload);
  if (provider === "slack") return summarizeSlack(payload);
  if (provider === "discord") return summarizeDiscord(payload);
  if (provider === "linear") return summarizeLinear(payload);
  return summarizeManual(payload);
}

interface GitHubHeadline {
  headline: string;
  actor: string | null;
}

const GITHUB_EVENT_SUMMARIES: Record<string, (payload: unknown) => GitHubHeadline> = {
  issue_comment: summarizeIssueComment,
  issues: summarizeIssue,
  pull_request_review: summarizePullRequestReview,
  pull_request_review_comment: summarizePullRequestReviewComment,
  push: summarizePush,
};

function summarizeGitHub(payload: unknown): TriggerSummary {
  const event = NormalizedGitHubEventSchema.safeParse(payload);
  if (!event.success) {
    return { provider: "github", headline: "GitHub event", actor: null, externalUrl: null };
  }
  const externalUrl = readGitHubTriggerUrl(event.data.payload) ?? null;
  const classified = classifyGitHubEvent(event.data);
  if (classified.semanticEvent === "github.pull_request_created") {
    return {
      provider: "github",
      headline:
        classified.item?.number === null || classified.item === null
          ? "Pull request created"
          : `Pull request #${String(classified.item.number)} created${classified.item.title === null ? "" : `: ${classified.item.title}`}`,
      actor: classified.actor.length === 0 ? null : classified.actor,
      externalUrl,
    };
  }
  const { headline, actor } = summarizeGitHubEvent(event.data.type, event.data.payload);
  return { provider: "github", headline, actor, externalUrl };
}

/**
 * The webhook receipt path validates only the permissive outer envelope, not the
 * event-specific shape — a stored row can have a `type` whose nested payload doesn't
 * match that type's schema. Isolate that single throwing call so one bad row falls
 * back to a generic headline instead of failing the whole snapshot.
 */
function summarizeGitHubEvent(type: string, payload: unknown): GitHubHeadline {
  const summarize = GITHUB_EVENT_SUMMARIES[type];
  if (summarize === undefined) return { headline: humanize(type), actor: null };
  try {
    return summarize(payload);
  } catch (error) {
    reportFailure(error, {
      operation: "project_activity.summarize",
      component: "projects",
      provider: "github",
    });
    return { headline: humanize(type), actor: null };
  }
}

function summarizeIssueComment(payload: unknown): GitHubHeadline {
  const body = IssueCommentPayloadSchema.parse(payload);
  const number = body.issue?.number;
  return {
    headline: number === undefined ? "Issue comment" : `Comment on #${String(number)}`,
    actor: body.sender?.login ?? body.comment?.user?.login ?? null,
  };
}

function summarizeIssue(payload: unknown): GitHubHeadline {
  const body = IssuesPayloadSchema.parse(payload);
  const number = body.issue?.number;
  const title = body.issue?.title;
  return {
    headline:
      number === undefined
        ? "Issue"
        : `Issue #${String(number)}${title === undefined ? "" : `: ${title}`}`,
    actor: body.sender?.login ?? null,
  };
}

function summarizePullRequestReview(payload: unknown): GitHubHeadline {
  const body = PullRequestReviewPayloadSchema.parse(payload);
  return {
    headline: "Pull request review",
    actor: body.sender?.login ?? body.review?.user?.login ?? null,
  };
}

function summarizePullRequestReviewComment(payload: unknown): GitHubHeadline {
  const body = PullRequestReviewCommentPayloadSchema.parse(payload);
  return {
    headline: "Pull request review comment",
    actor: body.sender?.login ?? body.comment?.user?.login ?? null,
  };
}

function summarizePush(payload: unknown): GitHubHeadline {
  const body = PushPayloadSchema.parse(payload);
  const branch = body.ref.replace(/^refs\/heads\//u, "");
  const count = body.commits.length;
  return {
    headline: `Push to ${branch}${count > 0 ? ` (${String(count)} commit${count === 1 ? "" : "s"})` : ""}`,
    actor: body.sender?.login ?? null,
  };
}

function summarizeSlack(payload: unknown): TriggerSummary {
  const event = NormalizedSlackMentionEventSchema.safeParse(payload);
  if (!event.success) {
    return { provider: "slack", headline: "Slack mention", actor: null, externalUrl: null };
  }
  const content = event.data.content.trim();
  return {
    provider: "slack",
    headline: content.length > 0 ? truncate(content, 96) : "Slack mention",
    actor: null,
    externalUrl: null,
  };
}

function summarizeDiscord(payload: unknown): TriggerSummary {
  const event = NormalizedDiscordMessageEventSchema.safeParse(payload);
  if (!event.success) {
    return { provider: "discord", headline: "Discord mention", actor: null, externalUrl: null };
  }
  const content = event.data.content.trim();
  return {
    provider: "discord",
    headline: content.length > 0 ? truncate(content, 96) : "Discord mention",
    actor: event.data.author.username,
    externalUrl: `https://discord.com/channels/${event.data.guildId}/${event.data.channelId}/${event.data.messageId}`,
  };
}

function summarizeLinear(payload: unknown): TriggerSummary {
  const event = NormalizedLinearEventSchema.safeParse(payload);
  if (!event.success) {
    return { provider: "linear", headline: "Linear event", actor: null, externalUrl: null };
  }
  const issue = event.data.type === "issue" ? event.data.issue : event.data.issue;
  if (issue === null) {
    return {
      provider: "linear",
      headline: "Linear comment",
      actor: event.data.actor?.name ?? null,
      externalUrl: null,
    };
  }
  const prefix = issue.identifier === undefined ? "Issue" : issue.identifier;
  return {
    provider: "linear",
    headline: `${prefix}: ${truncate(issue.title, 96)}`,
    actor: event.data.actor?.name ?? event.data.actor?.id ?? null,
    externalUrl: issue.url ?? null,
  };
}

function summarizeManual(payload: unknown): TriggerSummary {
  const parsed = ManualTriggerPayloadSchema.safeParse(payload);
  const triggerName = parsed.success ? parsed.data.trigger : undefined;
  return {
    provider: "manual",
    headline: triggerName === undefined ? "Manual run" : `Manual run: ${triggerName}`,
    actor: parsed.success ? (parsed.data.actor ?? null) : null,
    externalUrl: null,
  };
}

function humanize(value: string): string {
  const spaced = value.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
