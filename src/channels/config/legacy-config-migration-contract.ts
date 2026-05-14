import type { ChannelConfigBotKey } from "../integration/channel-config-key.ts";
import type { ChannelId } from "../integration/channel-surface-contract.ts";

export type ChannelLegacyConfigMigrationContract = {
  channel: ChannelId;
  configBotKey: ChannelConfigBotKey;
  legacyChannelKey?: string;
  defaultFields: readonly string[];
  botFields: readonly string[];
  legacyGroupKey?: string;
};
