import {
  createTopicChannelRouteShell,
  createTopicAwareChannelGroupRouteShell,
} from "../../config/channels/channel-route-shells.ts";

export default {
  channel: "telegram",
  configBotKey: "telegram",
  providerLabel: "Telegram",
  supportsTopics: true,
  createGroupRouteShell: createTopicAwareChannelGroupRouteShell,
  createTopicRouteShell: createTopicChannelRouteShell,
} as const;
