import type { ChannelLegacyConfigMigrationContract } from "../config/legacy-config-migration-contract.ts";

const slackLegacyConfigMigrationContract = {
  channel: "slack",
  configBotKey: "slack",
  defaultFields: [
    "channelPolicy",
    "ackReaction",
    "typingReaction",
    "replyToMode",
    "processingStatus",
  ],
  botFields: [
    "appToken",
    "botToken",
    "channelPolicy",
    "ackReaction",
    "typingReaction",
    "replyToMode",
    "processingStatus",
  ],
  legacyGroupKey: "channels",
} satisfies ChannelLegacyConfigMigrationContract;

export default slackLegacyConfigMigrationContract;
