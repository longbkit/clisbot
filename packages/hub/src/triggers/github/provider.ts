import type { ProjectConfigurationStore } from "../../configuration/store.js";
import type { JsonValue } from "../../config/compiler.js";
import {
  type TriggerProvider,
  type TriggerProviderMatch,
  type TriggerProviderReactionState,
} from "../index.js";
import type { GitHubAuth } from "../../auth/github.js";
import { reportFailure } from "../../failures/index.js";
import {
  matchTriggers,
  readGitHubInvocationMessage,
  readGitHubInvocationParserMessage,
  readGitHubMention,
} from "./match.js";
import { matchesInputFilters, parseInvocation } from "../invocation.js";
import {
  IssueCommentPayloadSchema,
  IssuesPayloadSchema,
  NormalizedGitHubEventSchema,
  PullRequestPayloadSchema,
  PullRequestReviewCommentPayloadSchema,
} from "../../auth/github-events.js";
import type { NormalizedGitHubEvent } from "../../auth/github-events.js";
import { classifyGitHubEvent, GITHUB_TRIGGER_SOURCE_NAMES } from "./classification.js";

export interface GitHubReactionClient {
  createReaction(input: {
    installationId: number;
    repo: string;
    subject: GitHubReactionSubject;
    content: GitHubReactionContent;
  }): Promise<GitHubCreatedReaction>;
  deleteReaction(input: {
    installationId: number;
    repo: string;
    subject: GitHubReactionSubject;
    reactionId: number;
  }): Promise<void>;
}

export interface GitHubCreatedReaction {
  id: number;
}

export type GitHubReactionContent =
  | "+1"
  | "-1"
  | "laugh"
  | "confused"
  | "heart"
  | "hooray"
  | "eyes";

export interface GitHubMergeData {
  github: {
    delivery_id: string;
    event_name: string;
    repository: { full_name: string };
    received_at: string;
    item: GitHubContextItem | null;
  };
}

interface GitHubContextItem {
  type: "issue" | "pull_request";
  number: number | null;
  title: string | null;
  body: string | null;
  url: string | null;
  author: { login: string } | null;
}

export function createGitHubReactionClient(
  auth: Pick<GitHubAuth, "createInstallationOctokit">,
): GitHubReactionClient {
  return {
    async createReaction(input) {
      const [owner, repo] = splitRepo(input.repo);
      const octokit = await auth.createInstallationOctokit(input.installationId);
      if (input.subject.kind === "item") {
        const response = await octokit.request(
          "POST /repos/{owner}/{repo}/issues/{issue_number}/reactions",
          { owner, repo, issue_number: input.subject.issueNumber, content: input.content },
        );
        return { id: response.data.id };
      }
      if (input.subject.kind === "issue_comment") {
        const response = await octokit.request(
          "POST /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions",
          { owner, repo, comment_id: input.subject.commentId, content: input.content },
        );
        return { id: response.data.id };
      }
      const response = await octokit.request(
        "POST /repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions",
        { owner, repo, comment_id: input.subject.commentId, content: input.content },
      );
      return { id: response.data.id };
    },
    async deleteReaction(input) {
      const [owner, repo] = splitRepo(input.repo);
      const octokit = await auth.createInstallationOctokit(input.installationId);
      if (input.subject.kind === "item") {
        await octokit.request(
          "DELETE /repos/{owner}/{repo}/issues/{issue_number}/reactions/{reaction_id}",
          { owner, repo, issue_number: input.subject.issueNumber, reaction_id: input.reactionId },
        );
      } else if (input.subject.kind === "issue_comment") {
        await octokit.request(
          "DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions/{reaction_id}",
          { owner, repo, comment_id: input.subject.commentId, reaction_id: input.reactionId },
        );
      } else {
        await octokit.request(
          "DELETE /repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions/{reaction_id}",
          { owner, repo, comment_id: input.subject.commentId, reaction_id: input.reactionId },
        );
      }
    },
  };
}

export type GitHubReactionSubject =
  | { kind: "item"; issueNumber: number }
  | { kind: "issue_comment"; commentId: number }
  | { kind: "pull_request_review_comment"; commentId: number };

export interface GitHubTriggerContext {
  provider: "github";
  target: { installationId: number; repository: string };
  event: GitHubMergeData;
  reactionSubject: GitHubReactionSubject | null;
}

interface GitHubReactionState {
  readonly [key: string]: JsonValue;
  readonly reactionId: number;
}

export function createGitHubTriggerProvider(options: {
  configurationStoreForProject: (projectId: string) => ProjectConfigurationStore;
  reactions: GitHubReactionClient;
}): TriggerProvider<"github", GitHubTriggerContext> {
  return {
    name: "github",
    eventNames: GITHUB_TRIGGER_SOURCE_NAMES,
    async match(externalTrigger) {
      const event = NormalizedGitHubEventSchema.parse(externalTrigger.payload);
      const stored = await options
        .configurationStoreForProject(externalTrigger.projectId)
        .getRevision(externalTrigger.configurationRevisionId);
      if (stored === undefined) return "configuration_unavailable";
      if (
        !stored.configuration.triggers.some((candidate) =>
          [externalTrigger.source, classifyGitHubEvent(event).semanticEvent].includes(candidate.on),
        )
      )
        return "no_trigger_for_source";
      const matches: TriggerProviderMatch<GitHubTriggerContext>[] = [];

      for (const match of matchTriggers(
        stored.configuration,
        event,
        externalTrigger.connectionId,
      )) {
        const compiledTrigger = stored.configuration.triggers.find(
          (candidate) => candidate.name === match.trigger.name,
        );
        if (compiledTrigger === undefined)
          throw new Error(`compiled trigger not found: ${match.trigger.name}`);
        const triggerContext: GitHubTriggerContext = {
          provider: "github",
          target: { installationId: event.installationId, repository: event.repo },
          event: buildGitHubMergeData(event),
          reactionSubject: reactionSubjectForEvent(event),
        };
        const invocation = parseInvocation(
          readGitHubInvocationMessage(event),
          compiledTrigger.inputs,
          readGitHubMention(event, compiledTrigger.filters),
          readGitHubInvocationParserMessage(event, compiledTrigger.filters),
        );
        if (invocation.status === "accepted") {
          if (!matchesInputFilters(invocation.inputs, compiledTrigger.filters?.inputs)) continue;
        }
        if (invocation.status === "rejected") {
          matches.push({
            triggerName: match.trigger.name,
            triggerContext,
            outputContext: triggerContext,
            configurationRevisionId: stored.revision.id,
            hubConfig: stored.configuration,
            invocation,
          });
          continue;
        }
        matches.push({
          triggerName: match.trigger.name,
          triggerContext,
          outputContext: triggerContext,
          configurationRevisionId: stored.revision.id,
          hubConfig: stored.configuration,
          invocation,
        });
      }

      return matches.length === 0 ? "trigger_filters_rejected" : matches;
    },
    async materializeContext(launch) {
      return launch.triggerContext.event;
    },
    async onDispatchAccepted(triggerContext, _outputContext, reactionState) {
      if (triggerContext.reactionSubject === null) return null;
      if (githubReactionId(reactionState) !== undefined) return reactionState;
      const reaction = await options.reactions.createReaction({
        installationId: triggerContext.target.installationId,
        repo: triggerContext.target.repository,
        subject: triggerContext.reactionSubject,
        content: "eyes",
      });
      return { reactionId: reaction.id } satisfies GitHubReactionState;
    },
    async onAgentExecutionCompleted(triggerContext, _outputContext, _result, reactionState) {
      return reactToLifecycle(options.reactions, triggerContext, "+1", reactionState);
    },
    async onAgentExecutionFailed(triggerContext, _outputContext, _reason, reactionState) {
      return reactToLifecycle(options.reactions, triggerContext, "-1", reactionState);
    },
    async onMachineTerminated(triggerContext, _reason, reactionState) {
      return reactToLifecycle(options.reactions, triggerContext, "-1", reactionState);
    },
  };
}

function buildGitHubMergeData(event: NormalizedGitHubEvent): GitHubMergeData {
  return {
    github: {
      delivery_id: event.id,
      event_name: event.type,
      repository: { full_name: event.repo },
      received_at: event.createdAt,
      item: classifyGitHubEvent(event).item,
    },
  };
}

async function reactToLifecycle(
  reactions: GitHubReactionClient,
  triggerContext: GitHubTriggerContext,
  content: GitHubReactionContent,
  reactionState?: TriggerProviderReactionState,
): Promise<GitHubReactionState | null> {
  if (triggerContext.reactionSubject === null) {
    return null;
  }

  await deleteReactionSafely(reactions, triggerContext, githubReactionId(reactionState));

  const reaction = await reactions.createReaction({
    installationId: triggerContext.target.installationId,
    repo: triggerContext.target.repository,
    subject: triggerContext.reactionSubject,
    content,
  });
  return { reactionId: reaction.id } satisfies GitHubReactionState;
}

async function deleteReactionSafely(
  reactions: GitHubReactionClient,
  triggerContext: GitHubTriggerContext,
  reactionId: number | undefined,
): Promise<void> {
  if (triggerContext.reactionSubject === null || reactionId === undefined) {
    return;
  }

  try {
    await reactions.deleteReaction({
      installationId: triggerContext.target.installationId,
      repo: triggerContext.target.repository,
      subject: triggerContext.reactionSubject,
      reactionId,
    });
  } catch (error) {
    reportFailure(
      error,
      { operation: "github.reaction.cleanup", component: "triggers", provider: "github" },
      { diagnostic: { repository: triggerContext.target.repository, reactionId } },
    );
  }
}

function githubReactionId(state: TriggerProviderReactionState | undefined): number | undefined {
  if (typeof state !== "object" || state === null || Array.isArray(state)) return undefined;
  const reactionId = state["reactionId"];
  return typeof reactionId === "number" && Number.isSafeInteger(reactionId)
    ? reactionId
    : undefined;
}

function reactionSubjectForEvent(event: NormalizedGitHubEvent): GitHubReactionSubject | null {
  if (event.type === "issues") {
    const payload = IssuesPayloadSchema.parse(event.payload);
    return payload.issue?.number === undefined
      ? null
      : { kind: "item", issueNumber: payload.issue.number };
  }

  if (event.type === "pull_request") {
    const payload = PullRequestPayloadSchema.parse(event.payload);
    return payload.pull_request?.number === undefined
      ? null
      : { kind: "item", issueNumber: payload.pull_request.number };
  }

  if (event.type === "issue_comment") {
    const payload = IssueCommentPayloadSchema.parse(event.payload);
    return payload.comment?.id === undefined
      ? null
      : { kind: "issue_comment", commentId: payload.comment.id };
  }

  if (event.type === "pull_request_review_comment") {
    const payload = PullRequestReviewCommentPayloadSchema.parse(event.payload);
    return payload.comment?.id === undefined
      ? null
      : { kind: "pull_request_review_comment", commentId: payload.comment.id };
  }

  return null;
}

function splitRepo(fullName: string): [owner: string, repo: string] {
  const [owner, repo] = fullName.split("/");

  if (owner === undefined || repo === undefined || owner.length === 0 || repo.length === 0) {
    throw new Error(`invalid GitHub repo full name: ${fullName}`);
  }

  return [owner, repo];
}
