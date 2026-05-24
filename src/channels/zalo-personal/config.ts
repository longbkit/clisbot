import type { ClisbotConfig } from "../../config/core/schema.ts";
import {
  listEnabledChannelProviderBotIds,
  mergeStandardChannelGroupRoutes,
  resolveChannelDirectMessageConfig,
  resolveChannelProviderBotId,
  resolveChannelProviderBotConfig,
  type ResolvedChannelBotConfig,
} from "../../config/channels/channel-bot-resolution.ts";
import type { ChannelBotRecord } from "../../config/channels/channel-config-shapes.ts";
import { createDefaultZaloPersonalDirectMessages } from "./defaults.ts";
import { buildDefaultZaloPersonalTokenFile } from "./session-path.ts";
import { resolveZaloPersonalSessionPath } from "./session-file.ts";

type ZaloPersonalRecord = ChannelBotRecord & {
  mode?: "listener";
  tokenFile?: string;
};

export type ZaloPersonalCredentialConfig = {
  tokenFile: string;
};

export type ResolvedZaloPersonalConfig = ResolvedChannelBotConfig & {
  mode: "listener";
  tokenFile: string;
};

function getExistingZaloPersonalTokenFile(existing?: Record<string, unknown>) {
  return typeof existing?.tokenFile === "string" && existing.tokenFile.trim()
    ? existing.tokenFile
    : undefined;
}

function getExistingFollowUp(existing?: Record<string, unknown>) {
  const followUp = existing?.followUp;
  if (!followUp || typeof followUp !== "object" || Array.isArray(followUp)) {
    return {};
  }
  return followUp as Record<string, unknown>;
}

export function buildZaloPersonalBotConfig(params: {
  botId: string;
  existing?: Record<string, unknown>;
  agentId?: string;
}) {
  const { botId, existing } = params;
  return {
    name: botId,
    dmPolicy: "allowlist",
    groupPolicy: "allowlist",
    directMessages: createDefaultZaloPersonalDirectMessages(),
    groups: {},
    ...existing,
    enabled: true,
    credentialType: "tokenFile",
    tokenFile: getExistingZaloPersonalTokenFile(existing) ?? buildDefaultZaloPersonalTokenFile(botId),
    ...(params.agentId ? { agentId: params.agentId } : {}),
    followUp: {
      mode: "mention-only",
      ...getExistingFollowUp(existing),
    },
  };
}

export function resolveZaloPersonalId(
  config: ClisbotConfig["bots"]["zaloPersonal"],
  botId?: string | null,
) {
  return resolveChannelProviderBotId(config, botId);
}

export function resolveZaloPersonalConfig(
  config: ClisbotConfig["bots"]["zaloPersonal"],
  botId?: string | null,
): ResolvedZaloPersonalConfig {
  const resolved = resolveChannelProviderBotConfig({
    config,
    providerLabel: "Zalo Personal",
    botId,
    mergeGroups: mergeStandardChannelGroupRoutes,
  });
  const botConfig = (config[resolved.id] ?? {}) as ZaloPersonalRecord;
  return {
    ...resolved,
    mode: "listener",
    tokenFile: botConfig.tokenFile?.trim() || buildDefaultZaloPersonalTokenFile(resolved.id),
  };
}

export function resolveZaloPersonalDirectMessageConfig(
  config: ResolvedZaloPersonalConfig,
  senderId?: string | number | null,
) {
  return resolveChannelDirectMessageConfig(config, senderId);
}

export function resolveZaloPersonalCredentials(
  config: ClisbotConfig["bots"]["zaloPersonal"],
  botId?: string | null,
): { botId: string; config: ZaloPersonalCredentialConfig } {
  const resolved = resolveZaloPersonalConfig(config, botId);
  return {
    botId: resolved.id,
    config: {
      tokenFile: resolved.tokenFile,
    },
  };
}

export function listZaloPersonalBots(
  config: ClisbotConfig["bots"]["zaloPersonal"],
): Array<{ botId: string; config: ZaloPersonalCredentialConfig }> {
  const seenTokenFiles = new Map<string, string>();
  return listEnabledChannelProviderBotIds(config).map((botId) => {
    const tokenFile = resolveZaloPersonalConfig(config, botId).tokenFile;
    const sessionPath = resolveZaloPersonalSessionPath(tokenFile);
    const existingBotId = seenTokenFiles.get(sessionPath);
    if (existingBotId) {
      throw new Error(
        `Zalo Personal bots ${existingBotId} and ${botId} use the same tokenFile; each bot/account needs a separate tokenFile.`,
      );
    }
    seenTokenFiles.set(sessionPath, botId);
    return {
      botId,
      config: { tokenFile },
    };
  });
}
