import type { ChannelLegacyConfigMigrationContract } from "../config/legacy-config-migration-contract.ts";

const telegramLegacyConfigMigrationContract = {
  channel: "telegram",
  configBotKey: "telegram",
  defaultFields: ["polling"],
  botFields: ["botToken", "polling"],
} satisfies ChannelLegacyConfigMigrationContract;

export default telegramLegacyConfigMigrationContract;
