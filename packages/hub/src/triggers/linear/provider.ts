import type { ProjectConfigurationStore } from "../../configuration/store.js";
import {
  LINEAR_ISSUE_COMMENT_CONTEXT_LIMIT,
  type LinearApiClient,
  type LinearIssueComment,
} from "../../providers/linear/client.js";
import { reportFailure } from "../../failures/index.js";
import type { TriggerProvider, TriggerProviderMatch } from "../index.js";
import { matchesInputFilters, parseInvocation } from "../invocation.js";
import { NormalizedLinearEventSchema, type NormalizedLinearEvent } from "./events.js";
import { matchLinearTriggers, readLinearCommentInvocationParserMessage } from "./match.js";

export interface LinearOutputContext {
  provider: "linear";
  linearOrganizationId: string;
  issueId: string;
}

export interface LinearTriggerContext {
  provider: "linear";
  target: LinearOutputContext;
  event: {
    linear: {
      event_type: "issue" | "comment";
      action: "create" | "update" | "remove";
      delivery_id: string;
      connection_id: string | null;
      organization: { id: string };
      actor: { id: string; name?: string | undefined } | null;
      issue: {
        id: string;
        identifier?: string;
        title: string;
        description: string | null;
        url?: string;
        project: { id: string } | null;
        state: { id: string } | null;
        assignee: { id: string } | null;
        label_ids: string[];
      };
      comment: { id: string; body: string } | null;
      trigger_thread_context:
        | {
            status: "deferred";
            issue: { id: string };
            before: { created_at: string };
          }
        | { status: "unavailable" };
    };
  };
}

export interface LinearIssueContextMessage {
  id: string;
  content: string;
  author: { id: string; name?: string } | null;
  created_at: string | null;
}

export interface LinearMaterializedContext {
  linear: Omit<LinearTriggerContext["event"]["linear"], "trigger_thread_context"> & {
    thread: {
      status: "available" | "incomplete" | "unavailable";
      messages: LinearIssueContextMessage[];
    };
  };
}

export function createLinearTriggerProvider(options: {
  configurationStoreForProject: (projectId: string) => ProjectConfigurationStore;
  client?: Pick<LinearApiClient, "readIssueComments">;
}): TriggerProvider<
  "linear",
  LinearTriggerContext,
  LinearOutputContext,
  LinearMaterializedContext
> {
  return {
    name: "linear",
    eventNames: ["linear.issue", "linear.comment"],
    async match(externalTrigger) {
      const event = NormalizedLinearEventSchema.parse(externalTrigger.payload);
      const stored = await options
        .configurationStoreForProject(externalTrigger.projectId)
        .getRevision(externalTrigger.configurationRevisionId);
      if (stored === undefined) return "configuration_unavailable";
      if (!hasSourceTrigger(stored.configuration.triggers, externalTrigger.source)) {
        return "no_trigger_for_source";
      }
      const matched = matchLinearTriggers(
        stored.configuration,
        event,
        externalTrigger.connectionId,
      );
      if (matched.length === 0) return "trigger_filters_rejected";

      const matches: TriggerProviderMatch<LinearTriggerContext, LinearOutputContext>[] = [];
      for (const candidate of matched) {
        const compiledTrigger = stored.configuration.triggers.find(
          (trigger) => trigger.name === candidate.trigger.name,
        );
        if (compiledTrigger === undefined) {
          throw new Error(`compiled trigger not found: ${candidate.trigger.name}`);
        }
        const issue = event.type === "issue" ? event.issue : event.issue;
        if (issue === null) continue;
        const outputContext: LinearOutputContext = {
          provider: "linear",
          linearOrganizationId: event.organizationId,
          issueId: issue.id,
        };
        const triggerContext: LinearTriggerContext = {
          provider: "linear",
          target: outputContext,
          event: {
            linear: buildLinearContext(
              event,
              externalTrigger.deliveryId,
              externalTrigger.connectionId,
            ),
          },
        };
        const prompt = promptForEvent(event);
        const invocation = parseInvocation(
          prompt,
          compiledTrigger.inputs,
          undefined,
          event.type === "comment"
            ? readLinearCommentInvocationParserMessage(event, compiledTrigger.filters)
            : prompt,
        );
        if (invocation.status === "accepted") {
          if (!matchesInputFilters(invocation.inputs, compiledTrigger.filters?.inputs)) continue;
          matches.push({
            triggerName: candidate.trigger.name,
            triggerContext,
            outputContext,
            configurationRevisionId: stored.revision.id,
            hubConfig: stored.configuration,
            invocation,
          });
        } else {
          matches.push({
            triggerName: candidate.trigger.name,
            triggerContext,
            outputContext,
            configurationRevisionId: stored.revision.id,
            hubConfig: stored.configuration,
            invocation,
          });
        }
      }
      return matches.length === 0 ? "trigger_filters_rejected" : matches;
    },
    async materializeContext(launch): Promise<LinearMaterializedContext> {
      const { trigger_thread_context: locator, ...linear } = launch.triggerContext.event.linear;
      const root = issueRootMessage(linear.issue);
      if (locator.status !== "deferred" || options.client === undefined) {
        return linearThreadContext(linear, "unavailable", [root]);
      }
      try {
        const history = await options.client.readIssueComments({
          linearOrganizationId: linear.organization.id,
          issueId: locator.issue.id,
          beforeCreatedAt: locator.before.created_at,
        });
        const causalComments = history.comments.filter((comment) =>
          isBeforeLinearTrigger(comment, locator.before.created_at),
        );
        const messages = causalComments
          .sort(compareLinearCommentOrder)
          .slice(-LINEAR_ISSUE_COMMENT_CONTEXT_LIMIT)
          .map(commentMessage);
        const complete =
          history.complete &&
          causalComments.length === history.comments.length &&
          causalComments.length <= LINEAR_ISSUE_COMMENT_CONTEXT_LIMIT;
        return linearThreadContext(linear, complete ? "available" : "incomplete", [
          root,
          ...messages,
        ]);
      } catch (error) {
        reportFailure(
          error,
          { operation: "linear.issue.history.hydrate", component: "triggers", provider: "linear" },
          {
            diagnostic: { linearOrganizationId: linear.organization.id, issueId: locator.issue.id },
          },
        );
        return linearThreadContext(linear, "unavailable", [root]);
      }
    },
  };
}

function linearThreadContext(
  linear: Omit<LinearTriggerContext["event"]["linear"], "trigger_thread_context">,
  status: LinearMaterializedContext["linear"]["thread"]["status"],
  messages: LinearIssueContextMessage[],
): LinearMaterializedContext {
  return { linear: { ...linear, thread: { status, messages } } };
}

function issueRootMessage(
  issue: LinearTriggerContext["event"]["linear"]["issue"],
): LinearIssueContextMessage {
  return {
    id: issue.id,
    content:
      issue.description === null || issue.description.length === 0
        ? issue.title
        : `${issue.title}\n\n${issue.description}`,
    author: null,
    created_at: null,
  };
}

function commentMessage(comment: LinearIssueComment): LinearIssueContextMessage {
  return {
    id: comment.id,
    content: comment.body,
    author: comment.author,
    created_at: comment.createdAt,
  };
}

function isBeforeLinearTrigger(comment: LinearIssueComment, beforeCreatedAt: string): boolean {
  const commentAt = Date.parse(comment.createdAt);
  const triggerAt = Date.parse(beforeCreatedAt);
  return Number.isFinite(commentAt) && Number.isFinite(triggerAt) && commentAt < triggerAt;
}

function compareLinearCommentOrder(left: LinearIssueComment, right: LinearIssueComment): number {
  const byCreatedAt = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  return byCreatedAt === 0 ? left.id.localeCompare(right.id) : byCreatedAt;
}

function hasSourceTrigger(triggers: readonly { on: string }[], source: string): boolean {
  return triggers.some((trigger) =>
    source === "linear.issue"
      ? trigger.on === "linear.issue_entered_scope" || trigger.on === "linear.issue_assigned"
      : source === "linear.comment" && trigger.on === "linear.comment_created",
  );
}

function promptForEvent(event: NormalizedLinearEvent): string {
  if (event.type === "comment") return event.comment.body;
  return event.issue.description === null
    ? event.issue.title
    : `${event.issue.title}\n\n${event.issue.description}`;
}

function buildLinearContext(
  event: NormalizedLinearEvent,
  deliveryId: string,
  connectionId: string | null | undefined,
): LinearTriggerContext["event"]["linear"] {
  const issue = event.type === "issue" ? event.issue : event.issue;
  if (issue === null) throw new Error("Linear event issue context unavailable");
  return {
    event_type: event.type,
    action: event.action,
    delivery_id: deliveryId,
    connection_id: connectionId ?? null,
    organization: { id: event.organizationId },
    actor: event.actor,
    issue: {
      id: issue.id,
      ...(issue.identifier === undefined ? {} : { identifier: issue.identifier }),
      title: issue.title,
      description: issue.description,
      ...(issue.url === undefined ? {} : { url: issue.url }),
      project: issue.projectId === null ? null : { id: issue.projectId },
      state: issue.stateId === null ? null : { id: issue.stateId },
      assignee: issue.assigneeId === null ? null : { id: issue.assigneeId },
      label_ids: issue.labelIds,
    },
    comment: event.type === "comment" ? { id: event.comment.id, body: event.comment.body } : null,
    trigger_thread_context:
      event.occurredAt === undefined
        ? { status: "unavailable" }
        : {
            status: "deferred",
            issue: { id: issue.id },
            before: { created_at: event.occurredAt },
          },
  };
}
