export default {
  channel: "slack",
  configBotKey: "slack",
  providerLabel: "Slack",
  literalTokenLabel: "slack token",
  fields: [
    {
      key: "appToken",
      label: "app token",
      primaryFlag: "--app-token",
      aliasFlags: ["--slack-app-token"],
      fileName: "app-token",
    },
    {
      key: "botToken",
      label: "bot token",
      primaryFlag: "--bot-token",
      aliasFlags: ["--slack-bot-token"],
      fileName: "bot-token",
    },
  ],
  createBotShellExtra: () => ({
    channelPolicy: "allowlist",
  }),
} as const;
