import type { ChannelBotRecord } from "../../config/channels/channel-config-shapes.ts";

function countZaloBotManagedRoutes(bot: ChannelBotRecord) {
  return Object.keys(bot.directMessages ?? {}).length;
}

export default {
  channel: "zalo-bot",
  configBotKey: "zaloBot",
  countManagedBotRoutes: countZaloBotManagedRoutes,
} as const;
