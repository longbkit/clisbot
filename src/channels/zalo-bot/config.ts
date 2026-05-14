import type { ClisbotConfig } from "../../config/core/schema.ts";
import {
  listEnabledChannelProviderBotIds,
  mergeStandardChannelGroupRoutes,
  resolveChannelDirectMessageAdmissionConfig,
  resolveChannelDirectMessageConfig,
  resolveChannelProviderBotId,
  resolveChannelProviderBotConfig,
  type ResolvedChannelBotConfig,
} from "../../config/channels/channel-bot-resolution.ts";
import type { ChannelBotRecord } from "../../config/channels/channel-config-shapes.ts";

type PollingConfig = {
  timeoutSeconds: number;
  retryDelayMs: number;
};

type ZaloBotProviderDefaults = ClisbotConfig["bots"]["zaloBot"]["defaults"] & {
  polling?: PollingConfig;
};

type ZaloBotRecord = ChannelBotRecord & {
  mode?: "polling" | "webhook";
  botToken?: string;
  polling?: Partial<PollingConfig>;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookPath?: string;
};

export type ZaloBotCredentialConfig = {
  botToken: string;
};

export type ResolvedZaloBotConfig = ResolvedChannelBotConfig & {
  mode: "polling" | "webhook";
  botToken: string;
  polling: NonNullable<ZaloBotProviderDefaults["polling"]>;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookPath?: string;
};

export function resolveZaloBotId(
  config: ClisbotConfig["bots"]["zaloBot"],
  botId?: string | null,
) {
  return resolveChannelProviderBotId(config, botId);
}

export function resolveZaloBotConfig(
  config: ClisbotConfig["bots"]["zaloBot"],
  botId?: string | null,
): ResolvedZaloBotConfig {
  const providerDefaults = config.defaults as ZaloBotProviderDefaults;
  const resolved = resolveChannelProviderBotConfig({
    config,
    providerLabel: "Zalo Bot",
    botId,
    mergeGroups: mergeStandardChannelGroupRoutes,
  });
  const botConfig = (config[resolved.id] ?? {}) as ZaloBotRecord;
  const pollingDefaults = providerDefaults.polling ?? {
    timeoutSeconds: 20,
    retryDelayMs: 1000,
  };
  return {
    ...resolved,
    mode: botConfig.mode === "webhook" ? "webhook" : "polling",
    botToken: botConfig.botToken?.trim() ?? "",
    polling: {
      timeoutSeconds: botConfig.polling?.timeoutSeconds ?? pollingDefaults.timeoutSeconds,
      retryDelayMs: botConfig.polling?.retryDelayMs ?? pollingDefaults.retryDelayMs,
    },
    webhookUrl: typeof botConfig.webhookUrl === "string" ? botConfig.webhookUrl : undefined,
    webhookSecret: typeof botConfig.webhookSecret === "string" ? botConfig.webhookSecret : undefined,
    webhookPath: typeof botConfig.webhookPath === "string" ? botConfig.webhookPath : undefined,
  };
}

export function resolveZaloBotDirectMessageConfig(
  config: ResolvedZaloBotConfig,
  senderId?: string | number | null,
) {
  return resolveChannelDirectMessageConfig(config, senderId);
}

export function resolveZaloBotDirectMessageAdmissionConfig(
  config: ResolvedZaloBotConfig,
) {
  return resolveChannelDirectMessageAdmissionConfig(config);
}

export function resolveZaloBotCredentials(
  config: ClisbotConfig["bots"]["zaloBot"],
  botId?: string | null,
): { botId: string; config: ZaloBotCredentialConfig } {
  const resolved = resolveZaloBotConfig(config, botId);
  if (!resolved.botToken) {
    throw new Error(`Unknown Zalo Bot: ${resolved.id}`);
  }
  return {
    botId: resolved.id,
    config: {
      botToken: resolved.botToken,
    },
  };
}

export function listZaloBotBots(
  config: ClisbotConfig["bots"]["zaloBot"],
): Array<{ botId: string; config: ZaloBotCredentialConfig }> {
  return listEnabledChannelProviderBotIds(config)
    .map((botId) => {
      const resolved = resolveZaloBotConfig(config, botId);
      return {
        botId,
        config: {
          botToken: resolved.botToken,
        },
      };
    })
    .filter(({ config }) => config.botToken.trim());
}
