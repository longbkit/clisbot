import type { AccessPrivilege } from "../access/contract.js";
import type { ChannelPrivilegeRequest } from "../access/store.js";
import type { CompiledChannelAccount, CompiledRoute } from "./config/compile.js";
import type { ChannelPlaneDeps, InboundMessage, OutboundPostParams } from "./plane/types.js";
import type { ChannelCommandName } from "./commands.js";

export function commandAccessRequest(
  deps: ChannelPlaneDeps,
  message: InboundMessage,
  account: CompiledChannelAccount,
  route: CompiledRoute | undefined,
  privilege: AccessPrivilege,
  capturedTarget?: import("./plane/types.js").ChannelAgentAccessTarget,
): ChannelPrivilegeRequest {
  const target =
    capturedTarget ??
    (route?.target.kind === "agent" ? deps.resolveAgentAccessTarget(route.target) : undefined);
  return {
    organizationId: deps.organizationId,
    connectionId: account.connectionId,
    channel: account.channel,
    accountId: account.accountId,
    senderIdentity: message.senderIdentity,
    conversation: message.conversation,
    privilege,
    ...(target ? { daemonReference: target.daemonReference, projectId: target.projectId } : {}),
  };
}

const PRIVATE_COMMANDS = new Set<ChannelCommandName>([
  "me",
  "status",
  "cowork",
  "agent",
  "provider",
  "model",
  "effort",
  "permission",
  "skill",
  "command",
]);

/** Private results never fall back to a public channel after delivery failure. */
export function commandReplyAddress(
  message: InboundMessage,
  name: ChannelCommandName,
): Pick<OutboundPostParams, "to" | "threadId"> {
  if (message.conversation.kind === "dm" || !PRIVATE_COMMANDS.has(name)) {
    return {
      to: message.conversation.rootConversationId,
      ...(message.conversation.threadId === null
        ? {}
        : { threadId: message.conversation.threadId }),
    };
  }
  const subject = message.senderIdentity.slice(message.channel.length + 1);
  return { to: message.channel === "telegram" ? subject : `user:${subject}` };
}

export function channelSessionLink(
  serverId: string | undefined,
  agentId: string,
  appWebUrl?: string,
): string | undefined {
  if (!serverId) return undefined;
  const path = `/h/${encodeURIComponent(serverId)}/agent/${encodeURIComponent(agentId)}`;
  if (!appWebUrl) return `paseo:/${path}`;
  const origin = new URL(appWebUrl);
  if (!["https:", "http:"].includes(origin.protocol) || origin.username || origin.password) {
    throw new Error("appWebUrl must be an http(s) app origin");
  }
  return new URL(path, origin).toString();
}

export async function channelIdentityText(
  deps: ChannelPlaneDeps,
  message: InboundMessage,
  account: CompiledChannelAccount,
  route?: CompiledRoute,
): Promise<string> {
  const request = commandAccessRequest(deps, message, account, route, "channel.use");
  const member = await deps.commandAccess?.resolveChannelMember(request);
  const privileges = ["channel.use", "agent.interact", "agent.create", "approval.config"] as const;
  const decisions = await Promise.all(
    privileges.map(async (privilege) =>
      (await deps.commandAccess?.authorizeChannelPrivilege({ ...request, privilege }))?.allowed
        ? privilege
        : undefined,
    ),
  );
  return [
    `Channel identity: ${message.senderIdentity}`,
    member ? `Hub Member: ${member.membershipId}` : "Hub access subject: Guest",
    `Access here: ${decisions.filter(Boolean).join(", ") || "public commands only"}`,
  ].join("\n");
}
