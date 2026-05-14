import { countStandardChannelBotRoutes } from "../../config/channels/channel-bot-records.ts";

export default {
  channel: "zalo-bot",
  configBotKey: "zaloBot",
  countManagedBotRoutes: countStandardChannelBotRoutes,
} as const;
