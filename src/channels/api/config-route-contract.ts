import { createStandardChannelGroupRouteShell } from "../../config/channels/channel-route-shells.ts";

export default {
  channel: "api",
  configBotKey: "api",
  providerLabel: "API",
  supportsGroups: true,
  supportsTopics: false,
  createGroupRouteShell: createStandardChannelGroupRouteShell,
} as const;
