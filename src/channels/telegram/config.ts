import type { ClisbotConfig } from "../../config/core/schema.ts";
import {
  listEnabledChannelProviderBotIds,
  mergeTopicAwareChannelGroupRoutes,
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

type TelegramProviderDefaults = ClisbotConfig["bots"]["telegram"]["defaults"] & {
  polling?: PollingConfig;
};

type TelegramBotRecord = ChannelBotRecord & {
  botToken?: string;
  polling?: Partial<PollingConfig>;
};

export type TelegramBotCredentialConfig = {
  botToken: string;
};

export type ResolvedTelegramBotConfig = ResolvedChannelBotConfig & {
  mode: "polling";
  botToken: string;
  polling: NonNullable<TelegramProviderDefaults["polling"]>;
};

export function resolveTelegramBotId(
  config: ClisbotConfig["bots"]["telegram"],
  botId?: string | null,
) {
  return resolveChannelProviderBotId(config, botId);
}

export function resolveTelegramBotConfig(
  config: ClisbotConfig["bots"]["telegram"],
  botId?: string | null,
): ResolvedTelegramBotConfig {
  const providerDefaults = config.defaults as TelegramProviderDefaults;
  const resolved = resolveChannelProviderBotConfig({
    config,
    providerLabel: "Telegram",
    botId,
    mergeGroups: mergeTopicAwareChannelGroupRoutes,
  });
  const botConfig = (config[resolved.id] ?? {}) as TelegramBotRecord;
  const pollingDefaults = providerDefaults.polling ?? {
    timeoutSeconds: 20,
    retryDelayMs: 1000,
  };
  return {
    ...resolved,
    mode: "polling",
    botToken: botConfig.botToken?.trim() ?? "",
    polling: {
      timeoutSeconds: botConfig.polling?.timeoutSeconds ?? pollingDefaults.timeoutSeconds,
      retryDelayMs: botConfig.polling?.retryDelayMs ?? pollingDefaults.retryDelayMs,
    },
  };
}

export function resolveTelegramDirectMessageConfig(
  config: ResolvedTelegramBotConfig,
  senderId?: string | number | null,
) {
  return resolveChannelDirectMessageConfig(config, senderId);
}

export function resolveTelegramBotCredentials(
  config: ClisbotConfig["bots"]["telegram"],
  botId?: string | null,
): { botId: string; config: TelegramBotCredentialConfig } {
  const resolved = resolveTelegramBotConfig(config, botId);
  if (!resolved.botToken) {
    throw new Error(`Unknown Telegram bot: ${resolved.id}`);
  }
  return {
    botId: resolved.id,
    config: {
      botToken: resolved.botToken,
    },
  };
}

export function listTelegramBots(
  config: ClisbotConfig["bots"]["telegram"],
): Array<{ botId: string; config: TelegramBotCredentialConfig }> {
  return listEnabledChannelProviderBotIds(config)
    .map((botId) => {
      const resolved = resolveTelegramBotConfig(config, botId);
      return {
        botId,
        config: {
          botToken: resolved.botToken,
        },
      };
    })
    .filter(({ config }) => config.botToken.trim());
}
