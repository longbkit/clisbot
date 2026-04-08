import { type LoadedConfig } from "../../config/load-config.ts";
import {
  buildAgentMainSessionKey,
  buildAgentPeerSessionKey,
} from "../../agents/session-key.ts";

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

  if (params.conversationKind === "dm") {
    return {
      agentId: params.agentId,
      sessionKey: buildAgentPeerSessionKey({
        agentId: params.agentId,
        mainKey: sessionConfig.mainKey,
        channel: "telegram",
        accountId: "default",
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
      accountId: "default",
      peerKind: "group",
      peerId,
    }),
    mainSessionKey,
    threadId: params.topicId != null ? String(params.topicId) : undefined,
  };
}
