import type {
  ChannelBotRecord,
  ChannelGroupRoute,
} from "../../config/channels/channel-config-shapes.ts";
import { createTopicChannelRouteShell } from "../../config/channels/channel-route-shells.ts";
import type { ClisbotConfig } from "../../config/core/schema.ts";
import { resolveChannelIdentityBotId } from "../surface/channel-identity.ts";
import type { ChannelSurfaceConfigTargetContract } from "../config/surface-config-target-contract.ts";
import {
  resolveDirectMessageTargetBinding,
  resolveSurfaceTargetBot,
} from "../config/surface-config-target-contract.ts";

function getTelegramGroup(
  bot: ChannelBotRecord,
  chatId: string,
) {
  return bot.groups[chatId];
}

function getOrCreateTelegramTopic(
  bot: ChannelBotRecord,
  chatId: string,
  topicId: string,
) {
  const group = getTelegramGroup(bot, chatId);
  if (!group) {
    throw new Error(
      `Route not configured yet: telegram topic:${chatId}:${topicId}. Add the route first.`,
    );
  }
  group.topics ??= {};
  const topic = group.topics[topicId];
  if (topic) {
    return topic;
  }
  const createdTopic = createTopicChannelRouteShell(group);
  group.topics[topicId] = createdTopic;
  return createdTopic;
}

function resolveTelegramTargetBinding(
  config: ClisbotConfig,
  botId: string | undefined,
  rawTarget?: string,
) {
  const resolved = resolveSurfaceTargetBot({
    config,
    configBotKey: "telegram",
    channel: "telegram",
    botId,
  });
  const resolvedBotId = resolved.botId;
  const bot = resolved.bot;

  if (!rawTarget) {
    return {
      label: `telegram bot ${resolvedBotId}`,
      getExactSource: () => bot,
      getFallbackSources: () => [],
      ensureWritableSource: () => bot,
    };
  }

  const [kind, routeId, topicId] = rawTarget.split(":", 3);
  if (kind === "dm") {
    return resolveDirectMessageTargetBinding({
      channel: "telegram",
      targetId: routeId ?? "",
      bot: bot as Record<string, unknown> & {
        directMessages: Record<string, Record<string, unknown>>;
      },
    });
  }

  if (kind === "group") {
    const chatId = routeId?.trim();
    if (!chatId) {
      throw new Error("telegram target must use group:<chatId>.");
    }
    const route = bot.groups[chatId];
    if (!route) {
      throw new Error(`Route not configured yet: telegram group:${chatId}. Add the route first.`);
    }
    return {
      label: `telegram group:${chatId}`,
      getExactSource: () => route,
      getFallbackSources: () => [bot],
      ensureWritableSource: () => route,
    };
  }

  if (kind === "topic") {
    const chatId = routeId?.trim();
    const nextTopicId = topicId?.trim();
    if (!chatId || !nextTopicId) {
      throw new Error("telegram target must use topic:<chatId>:<topicId>.");
    }
    const group = getTelegramGroup(bot, chatId);
    if (!group) {
      throw new Error(
        `Route not configured yet: telegram topic:${chatId}:${nextTopicId}. Add the route first.`,
      );
    }
    return {
      label: `telegram topic:${chatId}:${nextTopicId}`,
      getExactSource: () => (group as ChannelGroupRoute).topics?.[nextTopicId],
      getFallbackSources: () => [group, bot],
      ensureWritableSource: () => getOrCreateTelegramTopic(bot, chatId, nextTopicId),
    };
  }

  throw new Error("telegram target must use dm:<id|*>, group:<chatId>, or topic:<chatId>:<topicId>.");
}

export const telegramSurfaceConfigTargetContract = {
  channel: "telegram",
  resolveConfiguredSurfaceTargetBinding: (config, params) =>
    resolveTelegramTargetBinding(config, params.botId, params.target),
  buildConfiguredTargetFromIdentity: (identity, options = {}) => {
    const scope = options.scope ?? "conversation";
    const target =
      identity.conversationKind === "dm"
        ? `dm:${identity.senderId ?? identity.chatId ?? "*"}`
        : identity.conversationKind === "topic" && scope === "conversation"
          ? `topic:${identity.chatId ?? ""}:${identity.topicId ?? ""}`
          : `group:${identity.chatId ?? ""}`;

    return {
      channel: "telegram",
      botId: resolveChannelIdentityBotId(identity),
      target,
    };
  },
} satisfies ChannelSurfaceConfigTargetContract;

export default telegramSurfaceConfigTargetContract;
