export default {
  channel: "zalo-bot",
  configBotKey: "zaloBot",
  providerLabel: "Zalo Bot",
  literalTokenLabel: "zalo-bot token",
  fields: [
    {
      key: "botToken",
      label: "bot token",
      primaryFlag: "--bot-token",
      aliasFlags: ["--zalo-bot-token"],
      fileName: "bot-token",
    },
  ],
} as const;
