import type { MessageSubmissionWriter } from "@/composer/actions";
import type { OutboxFailure } from "@/outbox/model";
import { useSessionStore, type AgentSubmissionState } from "@/stores/session-store";
import {
  appendSubmittedUserMessage,
  removeSubmittedUserMessage,
  type StreamItem,
  type UserMessageItem,
} from "@/types/stream";
import { discardMessageSubmission, failMessageSubmission, retryMessageSubmission } from "./model";

function appendUntrackedSubmission(serverId: string, agentId: string, message: UserMessageItem) {
  const session = useSessionStore.getState().sessions[serverId];
  if (!session) return;
  const tail = session.agentStreamTail.get(agentId) ?? [];
  const head = session.agentStreamHead.get(agentId) ?? [];
  useSessionStore
    .getState()
    .setAgentStreamState(serverId, agentId, appendSubmittedUserMessage({ tail, head, message }));
}

function removeUntrackedSubmission(
  serverId: string,
  agentId: string,
  clientMessageId: string,
): void {
  const session = useSessionStore.getState().sessions[serverId];
  if (!session) return;
  const tail = session.agentStreamTail.get(agentId) ?? [];
  const head = session.agentStreamHead.get(agentId) ?? [];
  useSessionStore
    .getState()
    .setAgentStreamState(
      serverId,
      agentId,
      removeSubmittedUserMessage({ tail, head, clientMessageId }),
    );
}

function hasRow(items: readonly StreamItem[], clientMessageId: string): boolean {
  return items.some(
    (item) => item.kind === "user_message" && item.clientMessageId === clientMessageId,
  );
}

function update(
  serverId: string,
  agentId: string,
  change: (current: AgentSubmissionState) => AgentSubmissionState,
): void {
  useSessionStore.getState().updateAgentMessageSubmission(serverId, agentId, change);
}

function restoredSubmissions(
  submissions: AgentSubmissionState["submissions"],
  clientMessageId: string,
  tracked: boolean,
  failure: OutboxFailure | undefined,
): AgentSubmissionState["submissions"] {
  if (failure) return failMessageSubmission(submissions, clientMessageId, failure);
  return tracked ? retryMessageSubmission(submissions, clientMessageId) : submissions;
}

/** Transitions shared by tracked and untracked Hosts: the row stays, its record says why. */
function unsentRowTransitions(
  serverId: string,
  tracked: boolean,
): Pick<MessageSubmissionWriter, "fail" | "retry" | "discard" | "restore"> {
  return {
    fail: (agentId, clientMessageId, failure: OutboxFailure) =>
      update(serverId, agentId, (current) => ({
        ...current,
        submissions: failMessageSubmission(current.submissions, clientMessageId, failure),
      })),
    retry: (agentId, clientMessageId) =>
      update(serverId, agentId, (current) => ({
        ...current,
        // COMPAT(canonicalSubmittedPrompts): an old Host never acknowledges the row, so a
        // record would keep the agent busy; its row stays untracked while it is resent.
        submissions: tracked
          ? retryMessageSubmission(current.submissions, clientMessageId)
          : discardMessageSubmission(current.submissions, clientMessageId),
      })),
    discard: (agentId, clientMessageId) =>
      update(serverId, agentId, (current) => ({
        ...removeSubmittedUserMessage({ ...current, clientMessageId }),
        submissions: discardMessageSubmission(current.submissions, clientMessageId),
      })),
    restore: (agentId, message, failure) =>
      update(serverId, agentId, (current) => {
        const id = message.clientMessageId;
        if (!id) return current;
        const stream =
          hasRow(current.tail, id) || hasRow(current.head, id)
            ? current
            : appendSubmittedUserMessage({ ...current, message });
        return {
          tail: stream.tail,
          head: stream.head,
          submissions: restoredSubmissions(current.submissions, id, tracked, failure),
        };
      }),
  };
}

function createUntrackedMessageSubmissionWriter(serverId: string): MessageSubmissionWriter {
  return {
    begin: (agentId, message) => appendUntrackedSubmission(serverId, agentId, message),
    accept: (agentId, clientMessageId) =>
      update(serverId, agentId, (current) => ({
        ...current,
        submissions: discardMessageSubmission(current.submissions, clientMessageId),
      })),
    reject: (agentId, clientMessageId) => {
      removeUntrackedSubmission(serverId, agentId, clientMessageId);
      return "rejected";
    },
    ...unsentRowTransitions(serverId, false),
  };
}

export function createMessageSubmissionWriter(serverId: string): MessageSubmissionWriter {
  const supportsTrackedMessageSubmissions =
    useSessionStore.getState().sessions[serverId]?.serverInfo?.features
      ?.canonicalSubmittedPrompts === true;
  if (!supportsTrackedMessageSubmissions) {
    // COMPAT(canonicalSubmittedPrompts): added in v0.2.6; remove the gate after 2027-01-31 once daemon floor >= v0.2.6.
    return createUntrackedMessageSubmissionWriter(serverId);
  }
  return {
    begin: (agentId, message) =>
      useSessionStore.getState().beginAgentMessageSubmission(serverId, agentId, message),
    accept: (agentId, clientMessageId) =>
      useSessionStore.getState().acceptAgentMessageSubmission(serverId, agentId, clientMessageId),
    reject: (agentId, clientMessageId) =>
      useSessionStore.getState().rejectAgentMessageSubmission(serverId, agentId, clientMessageId),
    ...unsentRowTransitions(serverId, true),
  };
}

export function handoffCreatedAgentMessageSubmission(
  serverId: string,
  agentId: string,
  message: UserMessageItem,
): boolean {
  return useSessionStore.getState().handoffCreatedAgentUserMessage(serverId, agentId, message);
}
