import { createStandardChannelGroupRouteShell } from "../../config/channels/channel-route-shells.ts";

export default {
  channel: "slack",
  configBotKey: "slack",
  providerLabel: "Slack",
  supportsGroups: true,
  supportsTopics: false,
  legacyGroupPolicy: {
    read: (owner: Record<string, unknown>) => owner.channelPolicy,
    write: (owner: Record<string, unknown>, policy: "open" | "allowlist" | "disabled") => {
      owner.channelPolicy = policy;
    },
  },
  createGroupRouteShell: createStandardChannelGroupRouteShell,
} as const;
