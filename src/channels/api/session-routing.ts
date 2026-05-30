import type { LoadedConfig } from "../../config/core/load-config.ts";
import {
  buildAgentMainSessionKey,
  buildAgentPeerSessionKey,
} from "../../agents/session/session-key.ts";

export type ApiConversationTarget = {
  agentId: string;
  sessionKey: string;
  mainSessionKey: string;
};

export function resolveApiConversationTarget(params: {
  loadedConfig: LoadedConfig;
  agentId: string;
  botId: string;
  surfaceKind: "dm" | "group";
  surfaceId: string;
}) {
  const sessionConfig = params.loadedConfig.raw.session;
  const mainSessionKey = buildAgentMainSessionKey({
    agentId: params.agentId,
    mainKey: sessionConfig.mainKey,
  });
  return {
    agentId: params.agentId,
    sessionKey: buildAgentPeerSessionKey({
      agentId: params.agentId,
      mainKey: sessionConfig.mainKey,
      channel: "api",
      botId: params.botId,
      peerKind: params.surfaceKind,
      peerId: params.surfaceId,
      dmScope: sessionConfig.dmScope,
      identityLinks: sessionConfig.identityLinks,
    }),
    mainSessionKey,
  } satisfies ApiConversationTarget;
}
