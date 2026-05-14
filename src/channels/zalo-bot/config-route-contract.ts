import { createStandardChannelGroupRouteShell } from "../../config/channels/channel-route-shells.ts";

export default {
  channel: "zalo-bot",
  configBotKey: "zaloBot",
  providerLabel: "Zalo Bot",
  supportsTopics: false,
  createGroupRouteShell: createStandardChannelGroupRouteShell,
} as const;
