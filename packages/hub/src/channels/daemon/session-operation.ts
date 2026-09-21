import type { VerifiedSessionOperationIdentity } from "@getpaseo/protocol/session-operation";
import { createHash, randomUUID } from "node:crypto";
import { SessionInboundMessageSchema } from "@getpaseo/protocol/messages";
import { sessionOperationContent } from "@getpaseo/protocol/session-operation";
import type { AccessStore } from "../../access/store.js";
import type { Database } from "../../db/types.js";
import { normalizeHubOrigin } from "../../managed-access/hub-origin.js";
import type { AccessTicketService } from "../../managed-access/tickets.js";
import { hubSessionClientId } from "../../hub/protocol.js";
import type { InboundMessage } from "../plane/types.js";

/** Where an operation is admitted, plus the account's provider name lookup for its conversation. */
export interface ChannelIdentityTarget {
  organizationId: string;
  connectionId: string;
  /** The Channel account's conversation lookup (Slack `conversations.info`, Telegram `getChat`). */
  resolveConversationLabel?: (conversationId: string) => Promise<string | null>;
}
export interface ChannelOperationTarget extends ChannelIdentityTarget {
  daemonReference: string;
  clientId: string;
}

/**
 * Where a channel operation that rides a Host's own socket is admitted. The
 * daemon checks a ticket against the client id of the session presenting it,
 * which on this socket is the Hub's own `hello`, not a dial-out account's.
 */
export function hostSocketOperationTarget(
  hostId: string,
  identity: ChannelIdentityTarget,
): ChannelOperationTarget {
  return { ...identity, daemonReference: hostId, clientId: hubSessionClientId(hostId) };
}
export interface ChannelSystemOperation {
  kind: "system";
  channelId: string;
}
export type ChannelOperationSource = InboundMessage | ChannelSystemOperation;
function isSystemOperation(source: ChannelOperationSource): source is ChannelSystemOperation {
  return "kind" in source && source.kind === "system";
}
export type ChannelOperationTicketResolver = (
  message: Record<string, unknown>,
  source: ChannelOperationSource,
) => Promise<string>;

/** The native delivery ID survives ingress replay; identity snapshots remain immutable at the daemon. */
export function channelMessageId(source: InboundMessage): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        source.channel,
        source.accountId,
        source.conversation.rootConversationId,
        source.externalMessageId ?? source.ingressId ?? randomUUID(),
      ]),
    )
    .digest("hex");
}

/** In-process only: callers reach this after the channel plane's per-sender Gate 1. */
export function createChannelOperationTicketResolver(
  deps: {
    database: Database;
    access: AccessStore;
    tickets: AccessTicketService;
    hubOrigin: string;
  },
  target: ChannelOperationTarget,
): ChannelOperationTicketResolver {
  return async (message, source) => {
    const daemon = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(target.daemonReference)
      ? await deps.database.findDaemonForOrganization(target.organizationId, target.daemonReference)
      : await deps.database.findDaemonBySlugForOrganization(
          target.organizationId,
          target.daemonReference,
        );
    if (daemon?.status !== "active") throw new Error("Session operation daemon is unavailable");
    const identity = await resolveChannelOperationIdentity(deps, target, source);
    // Parse the same defaults the daemon validates before binding the exact operation digest.
    const validated = SessionInboundMessageSchema.parse({ requestId: "identity", ...message });
    return deps.tickets.sessionOperations.issue({
      daemonId: daemon.id,
      clientId: target.clientId,
      digest: createHash("sha256").update(sessionOperationContent(validated)).digest("hex"),
      identity,
    });
  };
}

/** Captured after Gate 1 and persisted with the Automation receipt before workflow dispatch. */
export async function resolveChannelOperationIdentity(
  deps: { access: AccessStore; hubOrigin: string },
  target: ChannelIdentityTarget,
  source: ChannelOperationSource,
): Promise<VerifiedSessionOperationIdentity> {
  const system = isSystemOperation(source);
  const member = system
    ? undefined
    : await deps.access.resolveChannelMember({
        organizationId: target.organizationId,
        connectionId: target.connectionId,
        channel: source.channel,
        senderIdentity: source.senderIdentity,
      });
  const hubOrigin = normalizeHubOrigin(deps.hubOrigin);
  const conversationId = system ? source.channelId : source.conversation.rootConversationId;
  return {
    actor: {
      kind: system ? "system" : "user",
      id: system ? "channel-approval-policy" : source.senderIdentity,
      // A linked identity is a known Member, so the snapshot carries their name over the
      // provider's sender name; `id` stays the provider identity either way.
      displayName: system ? "Channel approval policy" : (member?.name ?? source.senderName),
      // The Member's Hub profile image is the only avatar on this path: no
      // inbound vertical carries one (docs/features/agent-session-storage/design.md).
      ...(system || !member?.image ? {} : { avatarUrl: member.image }),
      hubOrigin,
      organizationId: target.organizationId,
      connectionId: target.connectionId,
      memberId: member?.membershipId,
    },
    channel: {
      hubOrigin,
      organizationId: target.organizationId,
      connectionId: target.connectionId,
      channelId: conversationId,
      displayName: system ? undefined : await conversationDisplayName(target, source),
      ...(system ? {} : { channel: source.channel }),
    },
  };
}

/**
 * The vertical's own label when the message carried one (Telegram group title), else the account's
 * cached provider lookup — Slack messages carry no channel name. A failed lookup keeps the raw id.
 */
async function conversationDisplayName(
  target: ChannelIdentityTarget,
  source: InboundMessage,
): Promise<string | undefined> {
  const carried = source.conversationLabel?.trim().slice(0, 200);
  if (carried) return carried;
  const resolved = await target
    .resolveConversationLabel?.(source.conversation.rootConversationId)
    .catch(() => null);
  return resolved?.trim().slice(0, 200) || undefined;
}
