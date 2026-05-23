import { countStandardChannelBotRoutes } from "../../config/channels/channel-bot-records.ts";

export default {
  channel: "zalo-personal",
  configBotKey: "zaloPersonal",
  countManagedBotRoutes: countStandardChannelBotRoutes,
} as const;
