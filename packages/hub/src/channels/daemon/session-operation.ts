import type { VerifiedSessionOperationIdentity } from "@getpaseo/protocol/session-operation";
import { createHash, randomUUID } from "node:crypto";
import { SessionInboundMessageSchema } from "@getpaseo/protocol/messages";
import { sessionOperationContent } from "@getpaseo/protocol/session-operation";
import type { AccessStore } from "../../access/store.js";
import type { Database } from "../../db/types.js";
import type { AccessTicketService } from "../../managed-access/tickets.js";
import type { InboundMessage } from "../plane/types.js";

export interface ChannelOperationTarget {
  organizationId: string;
  daemonReference: string;
  connectionId: string;
  clientId: string;
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
  target: Pick<ChannelOperationTarget, "organizationId" | "connectionId">,
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
  const hubOrigin = new URL(deps.hubOrigin).origin;
  return {
    actor: {
      kind: system ? "system" : "user",
      id: system ? "channel-approval-policy" : source.senderIdentity,
      displayName: system ? "Channel approval policy" : source.senderName,
      hubOrigin,
      organizationId: target.organizationId,
      connectionId: target.connectionId,
      memberId: member?.membershipId,
    },
    channel: {
      hubOrigin,
      organizationId: target.organizationId,
      connectionId: target.connectionId,
      channelId: isSystemOperation(source)
        ? source.channelId
        : source.conversation.rootConversationId,
      displayName: system ? undefined : source.conversationLabel,
    },
  };
}
