import { countStandardChannelBotRoutes } from "../../config/channels/channel-bot-records.ts";

export default {
  channel: "api",
  configBotKey: "api",
  countManagedBotRoutes: countStandardChannelBotRoutes,
} as const;
