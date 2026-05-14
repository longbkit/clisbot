import { type LoadedConfig } from "../../config/core/load-config.ts";
import {
  appendThreadSessionKey,
  buildAgentMainSessionKey,
  buildAgentPeerSessionKey,
} from "../../agents/session/session-key.ts";
import { resolveProvidedBotId } from "../../config/channels/channel-bot-records.ts";

export type SlackConversationTarget = {
  agentId: string;
  sessionKey: string;
  mainSessionKey: string;
  parentSessionKey?: string;
  threadId?: string;
};

export type SlackConversationKind = "dm" | "group" | "channel";

export function resolveSlackConversationTarget(params: {
  loadedConfig: LoadedConfig;
  agentId: string;
  botId?: string | null;
  accountId?: string | null;
  channelId: string;
  userId?: string | null;
  messageTs?: string | null;
  threadTs?: string | null;
  conversationKind: SlackConversationKind;
  replyToMode: "thread" | "all";
}): SlackConversationTarget {
  const sessionConfig = params.loadedConfig.raw.session;
  const mainSessionKey = buildAgentMainSessionKey({
    agentId: params.agentId,
    mainKey: sessionConfig.mainKey,
  });
  const botId = resolveProvidedBotId(params) ?? "default";

  if (params.conversationKind === "dm") {
    return {
      agentId: params.agentId,
      sessionKey: buildAgentPeerSessionKey({
        agentId: params.agentId,
        mainKey: sessionConfig.mainKey,
        channel: "slack",
        botId,
        peerKind: "dm",
        peerId: params.userId ?? params.channelId,
        dmScope: sessionConfig.dmScope,
        identityLinks: sessionConfig.identityLinks,
      }),
      mainSessionKey,
    };
  }

  if (params.conversationKind === "group") {
    return {
      agentId: params.agentId,
      sessionKey: buildAgentPeerSessionKey({
        agentId: params.agentId,
        mainKey: sessionConfig.mainKey,
        channel: "slack",
        botId,
        peerKind: "group",
        peerId: params.channelId,
      }),
      mainSessionKey,
    };
  }

  const parentSessionKey = buildAgentPeerSessionKey({
    agentId: params.agentId,
    mainKey: sessionConfig.mainKey,
    channel: "slack",
    botId,
    peerKind: "channel",
    peerId: params.channelId,
  });

  const threadId =
    (params.threadTs ?? "").trim() ||
    (params.replyToMode === "thread" ? (params.messageTs ?? "").trim() : "");

  return {
    agentId: params.agentId,
    sessionKey: appendThreadSessionKey(parentSessionKey, threadId),
    mainSessionKey,
    parentSessionKey: threadId ? parentSessionKey : undefined,
    threadId: threadId || undefined,
  };
}
