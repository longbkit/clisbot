import type { LoadedConfig } from "../../config/core/load-config.ts";
import {
  buildAgentMainSessionKey,
  buildAgentPeerSessionKey,
} from "../../agents/session/session-key.ts";
import type { ZaloPersonalConversationKind } from "./route-config.ts";

export function resolveZaloPersonalConversationTarget(params: {
  loadedConfig: LoadedConfig;
  agentId: string;
  botId?: string | null;
  chatId: string;
  userId?: string | null;
  conversationKind: ZaloPersonalConversationKind;
}) {
  const sessionConfig = params.loadedConfig.raw.session;
  const mainSessionKey = buildAgentMainSessionKey({
    agentId: params.agentId,
    mainKey: sessionConfig.mainKey,
  });
  const botId = params.botId?.trim() || "default";
  return {
    agentId: params.agentId,
    sessionKey: buildAgentPeerSessionKey({
      agentId: params.agentId,
      mainKey: sessionConfig.mainKey,
      channel: "zalo-personal",
      botId,
      peerKind: params.conversationKind,
      peerId: params.conversationKind === "dm" ? params.userId ?? params.chatId : params.chatId,
      dmScope: sessionConfig.dmScope,
      identityLinks: sessionConfig.identityLinks,
    }),
    mainSessionKey,
  };
}
