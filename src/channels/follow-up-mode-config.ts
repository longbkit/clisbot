import type { FollowUpMode } from "../agents/follow-up-policy.ts";
import { readEditableConfig, writeEditableConfig } from "../config/config-file.ts";
import {
  createDirectMessageBehaviorOverride,
  resolveDirectMessageExactRoute,
  resolveDirectMessageWildcardRoute,
} from "../config/direct-message-routes.ts";
import {
  getSlackBotRecord,
  getTelegramBotRecord,
  resolveSlackBotId,
  resolveTelegramBotId,
} from "../config/channel-bots.ts";
import type { BotRouteConfig, ClisbotConfig } from "../config/schema.ts";
import { resolveChannelIdentityBotId, type ChannelIdentity } from "./channel-identity.ts";

export type ConfiguredFollowUpModeScope = "channel" | "all";

type ConfiguredFollowUpModeTarget = {
  channel: "slack" | "telegram";
  botId?: string;
  scope: ConfiguredFollowUpModeScope;
  identity: ChannelIdentity;
};

type FollowUpModeTargetBinding = {
  get: () => FollowUpMode | undefined;
  set: (value: FollowUpMode) => void;
  label: string;
};

function getEditableConfigPath() {
  return process.env.CLISBOT_CONFIG_PATH;
}

function getOrCreateFollowUp(source: Record<string, unknown>) {
  const existing = source.followUp;
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return existing as { mode?: FollowUpMode };
  }

  const created: { mode?: FollowUpMode } = {};
  source.followUp = created;
  return created;
}

function createTelegramRouteOverride(): BotRouteConfig & {
  topics: Record<string, BotRouteConfig>;
} {
  return {
    enabled: true,
    allowUsers: [],
    blockUsers: [],
    topics: {},
  };
}

function getOrCreateTelegramGroupRoute(
  bot: NonNullable<ReturnType<typeof getTelegramBotRecord>>,
  chatId: string,
) {
  const existingGroup = bot.groups[chatId];
  if (existingGroup) {
    return existingGroup;
  }

  const createdGroup = createTelegramRouteOverride();
  bot.groups[chatId] = createdGroup;
  return createdGroup;
}

function resolveSlackFollowUpModeTarget(
  config: ClisbotConfig,
  params: ConfiguredFollowUpModeTarget,
): FollowUpModeTargetBinding {
  const botId = resolveSlackBotId(config.bots.slack, params.botId);
  const bot = getSlackBotRecord(config.bots.slack, botId);
  if (!bot) {
    throw new Error(`Unknown Slack bot: ${botId}`);
  }

  if (params.scope === "all") {
    return {
      get: () => bot.followUp?.mode,
      set: (value) => {
        getOrCreateFollowUp(bot).mode = value;
      },
      label: `slack bot ${botId}`,
    };
  }

  if (params.identity.conversationKind === "dm") {
    const targetId = params.identity.senderId?.trim() || params.identity.channelId?.trim();
    if (!targetId) {
      throw new Error("Slack follow-up channel scope requires a senderId or channelId.");
    }
    const routeKey = targetId;
    const wildcardRoute = resolveDirectMessageWildcardRoute(bot.directMessages);
    const existingRoute =
      resolveDirectMessageExactRoute(bot.directMessages, targetId) ??
      (bot.directMessages[routeKey] = createDirectMessageBehaviorOverride(wildcardRoute));
    return {
      get: () => existingRoute.followUp?.mode ?? bot.followUp?.mode,
      set: (value) => {
        getOrCreateFollowUp(existingRoute).mode = value;
      },
      label: `slack dm:${targetId}`,
    };
  }

  const channelId = params.identity.channelId?.trim();
  if (!channelId) {
    throw new Error("Slack follow-up channel scope requires a channelId.");
  }

  const routeKey = channelId;
  const route = bot.groups[routeKey];
  if (!route) {
    throw new Error(`Route not configured yet: slack group:${channelId}. Add the route first.`);
  }

  return {
    get: () => route.followUp?.mode ?? bot.followUp?.mode,
    set: (value) => {
      getOrCreateFollowUp(route).mode = value;
    },
      label: `slack group:${channelId}`,
    };
  }

function resolveTelegramFollowUpModeTarget(
  config: ClisbotConfig,
  params: ConfiguredFollowUpModeTarget,
): FollowUpModeTargetBinding {
  const botId = resolveTelegramBotId(config.bots.telegram, params.botId);
  const bot = getTelegramBotRecord(config.bots.telegram, botId);
  if (!bot) {
    throw new Error(`Unknown Telegram bot: ${botId}`);
  }

  if (params.scope === "all") {
    return {
      get: () => bot.followUp?.mode,
      set: (value) => {
        getOrCreateFollowUp(bot).mode = value;
      },
      label: `telegram bot ${botId}`,
    };
  }

  if (params.identity.conversationKind === "dm") {
    const targetId = params.identity.senderId?.trim() || params.identity.chatId?.trim();
    if (!targetId) {
      throw new Error("Telegram follow-up channel scope requires a senderId or chatId.");
    }
    const routeKey = targetId;
    const wildcardRoute = resolveDirectMessageWildcardRoute(bot.directMessages);
    const existingRoute =
      resolveDirectMessageExactRoute(bot.directMessages, targetId) ??
      (bot.directMessages[routeKey] = createDirectMessageBehaviorOverride(wildcardRoute));
    return {
      get: () => existingRoute.followUp?.mode ?? bot.followUp?.mode,
      set: (value) => {
        getOrCreateFollowUp(existingRoute).mode = value;
      },
      label: `telegram dm:${targetId}`,
    };
  }

  const chatId = params.identity.chatId?.trim();
  if (!chatId) {
    throw new Error("Telegram follow-up channel scope requires a chatId.");
  }

  const group = getOrCreateTelegramGroupRoute(bot, chatId);
  return {
    get: () => group.followUp?.mode ?? bot.followUp?.mode,
    set: (value) => {
      getOrCreateFollowUp(group).mode = value;
    },
    label: `telegram group:${chatId}`,
  };
}

function resolveConfiguredFollowUpModeTarget(
  config: ClisbotConfig,
  params: ConfiguredFollowUpModeTarget,
) {
  if (params.channel === "slack") {
    return resolveSlackFollowUpModeTarget(config, params);
  }

  return resolveTelegramFollowUpModeTarget(config, params);
}

export async function setScopedConversationFollowUpMode(params: {
  identity: ChannelIdentity;
  scope: ConfiguredFollowUpModeScope;
  mode: FollowUpMode;
}) {
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const target = resolveConfiguredFollowUpModeTarget(config, {
    channel: params.identity.platform,
    botId: resolveChannelIdentityBotId(params.identity),
    scope: params.scope,
    identity: params.identity,
  });
  target.set(params.mode);
  await writeEditableConfig(configPath, config);
  return {
    configPath,
    label: target.label,
    followUpMode: params.mode,
  };
}
