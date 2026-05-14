import { type LoadedConfig } from "../../config/core/load-config.ts";
import {
  buildAgentMainSessionKey,
  buildAgentPeerSessionKey,
} from "../../agents/session/session-key.ts";
import { resolveProvidedBotId } from "../../config/channels/channel-bot-records.ts";

export type TelegramConversationKind = "dm" | "group" | "topic";

export type TelegramConversationTarget = {
  agentId: string;
  sessionKey: string;
  mainSessionKey: string;
  threadId?: string;
};

export function resolveTelegramConversationTarget(params: {
  loadedConfig: LoadedConfig;
  agentId: string;
  botId?: string | null;
  accountId?: string | null;
  chatId: number;
  userId?: number | null;
  conversationKind: TelegramConversationKind;
  topicId?: number | null;
}) {
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
        channel: "telegram",
        botId,
        peerKind: "dm",
        peerId: String(params.userId ?? params.chatId),
        dmScope: sessionConfig.dmScope,
        identityLinks: sessionConfig.identityLinks,
      }),
      mainSessionKey,
    };
  }

  const peerId =
    params.conversationKind === "topic" && params.topicId != null
      ? `${params.chatId}:topic:${params.topicId}`
      : String(params.chatId);

  return {
    agentId: params.agentId,
    sessionKey: buildAgentPeerSessionKey({
      agentId: params.agentId,
      mainKey: sessionConfig.mainKey,
      channel: "telegram",
      botId,
      peerKind: "group",
      peerId,
    }),
    mainSessionKey,
    threadId: params.topicId != null ? String(params.topicId) : undefined,
  };
}
