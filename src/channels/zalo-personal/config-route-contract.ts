import { createStandardChannelGroupRouteShell } from "../../config/channels/channel-route-shells.ts";

export default {
  channel: "zalo-personal",
  configBotKey: "zaloPersonal",
  providerLabel: "Zalo Personal",
  supportsGroups: true,
  supportsTopics: false,
  createGroupRouteShell: createStandardChannelGroupRouteShell,
} as const;
