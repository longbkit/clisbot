import type { LoadedConfig } from "../../config/load-config.ts";
import {
  buildAgentMainSessionKey,
  buildAgentPeerSessionKey,
} from "../../agents/session-key.ts";

export type WebConversationTarget = {
  agentId: string;
  sessionKey: string;
  mainSessionKey: string;
  contextId?: string;
};

export function resolveWebConversationTarget(params: {
  loadedConfig: LoadedConfig;
  agentId: string;
  contextId?: string;
}): WebConversationTarget {
  const sessionConfig = params.loadedConfig.raw.session;
  const mainSessionKey = buildAgentMainSessionKey({
    agentId: params.agentId,
    mainKey: sessionConfig.mainKey,
  });

  // Per-todo sessions get their own conversation context; otherwise falls back to main DM.
  const peerId = params.contextId ? `todo:${params.contextId}` : "web:main";

  return {
    agentId: params.agentId,
    sessionKey: buildAgentPeerSessionKey({
      agentId: params.agentId,
      mainKey: sessionConfig.mainKey,
      channel: "web",
      botId: "default",
      peerKind: "dm",
      peerId,
      dmScope: sessionConfig.dmScope,
      identityLinks: sessionConfig.identityLinks,
    }),
    mainSessionKey,
    contextId: params.contextId,
  };
}
