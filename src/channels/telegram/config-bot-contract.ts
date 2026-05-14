import type { ChannelBotRecord } from "../../config/channels/channel-config-shapes.ts";

function countTelegramManagedBotRoutes(bot: ChannelBotRecord) {
  const groupCount = Object.keys(bot.groups ?? {}).length;
  const topicCount = Object.values(bot.groups ?? {}).reduce((total, group) => {
    return total + Object.keys(group.topics ?? {}).length;
  }, 0);
  return groupCount + topicCount + Object.keys(bot.directMessages ?? {}).length;
}

export default {
  channel: "telegram",
  configBotKey: "telegram",
  countManagedBotRoutes: countTelegramManagedBotRoutes,
} as const;
