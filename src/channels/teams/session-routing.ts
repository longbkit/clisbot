import type { LoadedConfig } from "../../config/load-config.ts";
import {
  buildAgentMainSessionKey,
  buildAgentPeerSessionKey,
} from "../../agents/session-key.ts";

export type TeamsConversationKind = "dm" | "channel" | "group";

export type TeamsConversationTarget = {
  agentId: string;
  sessionKey: string;
  mainSessionKey: string;
};

export function resolveTeamsConversationTarget(params: {
  loadedConfig: LoadedConfig;
  agentId: string;
  botId?: string | null;
  conversationId: string;
  userId?: string | null;
  conversationKind: TeamsConversationKind;
}): TeamsConversationTarget {
  const sessionConfig = params.loadedConfig.raw.session;
  const mainSessionKey = buildAgentMainSessionKey({
    agentId: params.agentId,
    mainKey: sessionConfig.mainKey,
  });

  const botId = params.botId ?? "default";

  if (params.conversationKind === "dm") {
    return {
      agentId: params.agentId,
      sessionKey: buildAgentPeerSessionKey({
        agentId: params.agentId,
        mainKey: sessionConfig.mainKey,
        channel: "teams",
        botId,
        peerKind: "dm",
        peerId: params.userId ?? params.conversationId,
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
      channel: "teams",
      botId,
      peerKind: "group",
      peerId: params.conversationId,
    }),
    mainSessionKey,
  };
}
