import {
  createTopicChannelRouteShell,
  createTopicAwareChannelGroupRouteShell,
} from "../../config/channels/channel-route-shells.ts";

export default {
  channel: "telegram",
  configBotKey: "telegram",
  providerLabel: "Telegram",
  supportsGroups: true,
  supportsTopics: true,
  createGroupRouteShell: createTopicAwareChannelGroupRouteShell,
  createTopicRouteShell: createTopicChannelRouteShell,
} as const;
