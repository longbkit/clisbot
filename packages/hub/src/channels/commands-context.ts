import type { AccessPrivilege } from "../access/contract.js";
import type { ChannelPrivilegeRequest } from "../access/store.js";
import type { CompiledChannelAccount, CompiledRoute } from "./config/compile.js";
import type { ChannelPlaneDeps, InboundMessage, OutboundPostParams } from "./plane/types.js";
import { anchoredReplyThreadId } from "./reply-anchor.js";
import { sessionDeepLink, sessionOpenUrl } from "./session-open-link.js";

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

/**
 * Every command answers where it was asked, including the ones that carry a
 * session link. A reply delivered anywhere else — a DM the caller is not
 * looking at — is indistinguishable from the bot ignoring the command, which
 * is what a private-by-default reply cost us in Slack.
 *
 * "Where it was asked" follows the Route's `reply.anchor` exactly as the
 * agent's own replies do: under `thread`, a command sent at the channel root
 * is answered in a thread on that message. Without a Route (`/help` and `/me`
 * in an unrouted conversation) there is no anchor, and the reply stays put.
 */
export function commandReplyAddress(
  message: InboundMessage,
  replyAnchor: "default" | "thread" = "default",
): Pick<OutboundPostParams, "to" | "threadId"> {
  const threadId = anchoredReplyThreadId({
    channel: message.channel,
    rootKind: message.conversation.kind === "dm" ? "dm" : "channel",
    replyAnchor,
    threadId: message.conversation.threadId,
    messageId: message.externalMessageId,
  });
  return {
    to: message.conversation.rootConversationId,
    ...(threadId === undefined ? {} : { threadId }),
  };
}

/** Both ways into one session: one opens the installed app, one opens the
 * browser. The reader picks — a Slack thread has desktop, phone and browser
 * readers in it, and the channel cannot know which one is open. */
export interface ChannelSessionLinks {
  app: string;
  web?: string;
}

export function channelSessionLinks(
  serverId: string | undefined,
  agentId: string,
  appWebUrl?: string,
): ChannelSessionLinks | undefined {
  if (!serverId) return undefined;
  if (!appWebUrl) return { app: sessionDeepLink(serverId, agentId) };
  const origin = new URL(appWebUrl);
  if (!["https:", "http:"].includes(origin.protocol) || origin.username || origin.password) {
    throw new Error("appWebUrl must be an http(s) app origin");
  }
  const path = `/h/${encodeURIComponent(serverId)}/agent/${encodeURIComponent(agentId)}`;
  return {
    app: sessionOpenUrl(origin.toString(), serverId, agentId),
    web: new URL(path, origin).toString(),
  };
}

/**
 * Markdown link syntax, so a channel renders two short labels instead of two
 * URLs that wrap over four lines. Only an `http(s)` URL survives that: a
 * `paseo://` link inside link markup is shown as literal markup by Slack, which
 * is why the app destination goes through the Hub's redirect when an origin is
 * configured — and stays a bare, copyable URL when one is not.
 */
export function channelSessionLinkText(links: ChannelSessionLinks): string {
  const app = links.web
    ? `[Open in the Clisbot app](${links.app})`
    : `Open in the Clisbot app: ${links.app}`;
  return [...(links.web ? [`[Open in the web app](${links.web})`] : []), app].join("\n");
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
