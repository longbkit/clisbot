import {
  notificationAllowed,
  notificationOwnership,
  notificationReaderKey,
  type NotificationOwnership,
  type NotificationOwnershipEvidence,
  type NotificationReader,
} from "@clisbot/protocol/notification-audience";
import { PARENT_AGENT_ID_LABEL } from "@clisbot/protocol/agent-labels";
import type { SessionAuthorship } from "@clisbot/protocol/session-authorship";

import {
  computeNotificationPlan,
  type AttentionFocusTarget,
  type ClientPresenceState,
} from "../agent-attention-policy.js";

/** How far up a subagent's parents ownership is looked for, as the session list does. */
const MAX_PARENT_DEPTH = 8;

export interface AttentionClient<Client> {
  client: Client;
  /** Null when the connection cannot be attributed to anyone. */
  reader: NotificationReader | null;
  state: ClientPresenceState;
}

export interface AttentionAudiencePlan<Client> {
  /** The one present client per reader that shows the notification in the app. */
  inAppRecipients: ReadonlySet<Client>;
  /** Which push token readers still need a push: allowed, and not reached in the app. */
  pushRecipients: (reader: NotificationReader) => boolean;
}

/**
 * Plans one attention notification per reader. Each person's own presence
 * decides between an in-app notification and a push, so a teammate's open app
 * neither receives this reader's notification nor suppresses their push.
 *
 * The Host owner's direct devices carry no Hub identity, so the daemon cannot
 * tell them from the same person's Hub-admitted phone. They are planned as
 * separate readers: the owner may be notified on both, never on neither.
 */
export function planAttentionAudience<Client>(input: {
  clients: readonly AttentionClient<Client>[];
  allows: (reader: NotificationReader) => boolean;
  focusTarget: AttentionFocusTarget;
  pushEligible: boolean;
  nowMs: number;
}): AttentionAudiencePlan<Client> {
  const groups = new Map<string, AttentionClient<Client>[]>();
  for (const entry of input.clients) {
    if (entry.reader === null || !input.allows(entry.reader)) continue;
    const key = notificationReaderKey(entry.reader.actor);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const inAppRecipients = new Set<Client>();
  const reached = new Set<string>();
  for (const [key, entries] of groups) {
    const plan = computeNotificationPlan({
      allStates: entries.map((entry) => entry.state),
      focusTarget: input.focusTarget,
      pushEligible: input.pushEligible,
      nowMs: input.nowMs,
    });
    if (plan.inAppRecipientIndex !== null)
      inAppRecipients.add(entries[plan.inAppRecipientIndex]!.client);
    if (!plan.shouldPush) reached.add(key);
  }
  return {
    inAppRecipients,
    pushRecipients: (reader) =>
      input.pushEligible &&
      input.allows(reader) &&
      !reached.has(notificationReaderKey(reader.actor)),
  };
}

type AgentEvidenceSource = SessionAuthorship & { labels?: Record<string, string> };

/** A session's ownership evidence, with its nearest ancestors for a subagent. */
export async function agentNotificationEvidence(
  agent: AgentEvidenceSource,
  findAgent: (agentId: string) => Promise<AgentEvidenceSource | null>,
  depth = 0,
): Promise<NotificationOwnershipEvidence> {
  const evidence: NotificationOwnershipEvidence = {
    createdBy: agent.createdBy,
    ownerActor: agent.ownerActor,
    lastMessageBy: agent.lastMessageBy,
    participantActors: agent.participantActors,
  };
  const parentId = agent.labels?.[PARENT_AGENT_ID_LABEL];
  if (!parentId || depth >= MAX_PARENT_DEPTH) return evidence;
  const parent = await findAgent(parentId);
  return parent
    ? { ...evidence, parent: await agentNotificationEvidence(parent, findAgent, depth + 1) }
    : evidence;
}

/** Whether a session with `evidence` may notify `reader`. */
export function allowsAgentNotification(
  evidence: NotificationOwnershipEvidence,
): (reader: NotificationReader) => boolean {
  return (reader) =>
    notificationAllowed(
      reader,
      reader.actor === null ? "mine" : notificationOwnership(reader.actor, evidence),
    );
}

/** A terminal records only the Hub actor id that launched it, and only while it runs. */
export function allowsTerminalNotification(
  createdBy: string | undefined,
): (reader: NotificationReader) => boolean {
  return (reader) => {
    let ownership: NotificationOwnership = "unknown";
    if (reader.actor === null) ownership = "mine";
    else if (createdBy !== undefined) ownership = createdBy === reader.actor.id ? "mine" : "others";
    return notificationAllowed(reader, ownership);
  };
}
