export default {
  channel: "telegram",
  configBotKey: "telegram",
  providerLabel: "Telegram",
  literalTokenLabel: "telegram bot token",
  fields: [
    {
      key: "botToken",
      label: "bot token",
      primaryFlag: "--bot-token",
      aliasFlags: ["--telegram-bot-token"],
      fileName: "bot-token",
    },
  ],
} as const;
