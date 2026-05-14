import { type LoadedConfig } from "../../config/core/load-config.ts";
import {
  buildAgentMainSessionKey,
  buildAgentPeerSessionKey,
} from "../../agents/session/session-key.ts";
import { resolveProvidedBotId } from "../../config/channels/channel-bot-records.ts";

export type ZaloBotConversationKind = "dm" | "group";

export function resolveZaloBotConversationTarget(params: {
  loadedConfig: LoadedConfig;
  agentId: string;
  botId?: string | null;
  accountId?: string | null;
  chatId: string;
  userId?: string | null;
  conversationKind: ZaloBotConversationKind;
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
        channel: "zalo-bot",
        botId,
        peerKind: "dm",
        peerId: params.userId ?? params.chatId,
        dmScope: sessionConfig.dmScope,
        identityLinks: sessionConfig.identityLinks,
      }),
      mainSessionKey,
    };
  }

  return {
    agentId: params.agentId,
    sessionKey: buildAgentPeerSessionKey({
      agentId: params.agentId,
      mainKey: sessionConfig.mainKey,
      channel: "zalo-bot",
      botId,
      peerKind: "group",
      peerId: params.chatId,
    }),
    mainSessionKey,
  };
}
