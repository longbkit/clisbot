import { countStandardChannelBotRoutes } from "../../config/channels/channel-bot-records.ts";

export default {
  channel: "slack",
  configBotKey: "slack",
  countManagedBotRoutes: countStandardChannelBotRoutes,
} as const;
