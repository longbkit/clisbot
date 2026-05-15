import type { ClisbotConfig } from "../../config/core/schema.ts";
import {
  listEnabledChannelProviderBotIds,
  mergeStandardChannelGroupRoutes,
  resolveChannelDirectMessageConfig,
  resolveChannelProviderBotId,
  resolveChannelProviderBotConfig,
  type ResolvedChannelBotConfig,
} from "../../config/channels/channel-bot-resolution.ts";
import type {
  ChannelBotRecord,
  ChannelProviderDefaults,
} from "../../config/channels/channel-config-shapes.ts";

export type SlackBotCredentialConfig = {
  appToken: string;
  botToken: string;
};

type SlackProcessingStatusConfig = {
  enabled: boolean;
  status: string;
  loadingMessages: string[];
};

type SlackProviderDefaults = ChannelProviderDefaults & {
  mode: "socket";
  channelPolicy?: "open" | "allowlist" | "disabled";
  ackReaction?: string;
  typingReaction?: string;
  replyToMode?: "thread" | "all";
  processingStatus?: SlackProcessingStatusConfig;
};

type SlackBotRecord = ChannelBotRecord & {
  channelPolicy?: "open" | "allowlist" | "disabled";
  ackReaction?: string;
  typingReaction?: string;
  replyToMode?: "thread" | "all";
  processingStatus?: SlackProcessingStatusConfig;
};

export type ResolvedSlackBotConfig = ResolvedChannelBotConfig & {
  mode: "socket";
  channelPolicy: "open" | "allowlist" | "disabled";
  appToken: string;
  botToken: string;
  ackReaction: string;
  typingReaction: string;
  replyToMode: "thread" | "all";
  processingStatus: SlackProcessingStatusConfig;
};

export function resolveSlackBotId(
  config: ClisbotConfig["bots"]["slack"],
  botId?: string | null,
) {
  return resolveChannelProviderBotId(config, botId);
}

export function resolveSlackBotConfig(
  config: ClisbotConfig["bots"]["slack"],
  botId?: string | null,
): ResolvedSlackBotConfig {
  const providerDefaults = config.defaults as SlackProviderDefaults;
  const resolved = resolveChannelProviderBotConfig({
    config,
    providerLabel: "Slack",
    botId,
    mergeGroups: mergeStandardChannelGroupRoutes,
  });
  const botConfig = (config[resolved.id] ?? {}) as SlackBotRecord;
  return {
    ...resolved,
    mode: "socket",
    channelPolicy: botConfig.channelPolicy ?? providerDefaults.channelPolicy ?? "allowlist",
    appToken: botConfig.appToken?.trim() ?? "",
    botToken: botConfig.botToken?.trim() ?? "",
    ackReaction: botConfig.ackReaction ?? providerDefaults.ackReaction ?? "",
    typingReaction: botConfig.typingReaction ?? providerDefaults.typingReaction ?? "",
    replyToMode: botConfig.replyToMode ?? providerDefaults.replyToMode ?? "thread",
    processingStatus:
      botConfig.processingStatus ??
      providerDefaults.processingStatus ?? {
        enabled: true,
        status: "Working...",
        loadingMessages: [],
      },
  };
}

export function resolveSlackDirectMessageConfig(
  config: ResolvedSlackBotConfig,
  userId?: string | null,
) {
  return resolveChannelDirectMessageConfig(config, userId);
}

export function resolveSlackBotCredentials(
  config: ClisbotConfig["bots"]["slack"],
  botId?: string | null,
): { botId: string; config: SlackBotCredentialConfig } {
  const resolved = resolveSlackBotConfig(config, botId);
  if (resolved.appToken && resolved.botToken) {
    return {
      botId: resolved.id,
      config: {
        appToken: resolved.appToken,
        botToken: resolved.botToken,
      },
    };
  }

  throw new Error(`Unknown Slack bot: ${resolved.id}`);
}

export function listSlackBots(
  config: ClisbotConfig["bots"]["slack"],
): Array<{ botId: string; config: SlackBotCredentialConfig }> {
  return listEnabledChannelProviderBotIds(config)
    .map((botId) => {
      const resolved = resolveSlackBotConfig(config, botId);
      return {
        botId,
        config: {
          appToken: resolved.appToken,
          botToken: resolved.botToken,
        },
      };
    })
    .filter(({ config }) => config.appToken.trim() && config.botToken.trim());
}
