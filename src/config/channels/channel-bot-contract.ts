import type { ClisbotConfig } from "../core/schema.ts";
import type { ChannelId } from "../../channels/integration/channel-surface-contract.ts";
import { CHANNEL_BOT_CONTRACTS } from "../../channels/integration/channel-installation-inventory.ts";
import {
  countStandardChannelBotRoutes,
  getConfiguredDefaultBotId,
  normalizeBotId,
} from "./channel-bot-records.ts";
import type {
  ChannelBotRecord,
  ChannelConfigBotKey,
  ChannelProviderConfig,
  ChannelProviderDefaults,
} from "./channel-config-shapes.ts";

export type ChannelManagedBotConfig = ChannelBotRecord;
export type ChannelManagedProviderDefaults = ChannelProviderDefaults;

export type ChannelBotContract = {
  channel: ChannelId;
  configBotKey: ChannelConfigBotKey;
  countManagedBotRoutes(bot: ChannelManagedBotConfig): number;
};

export function listChannelBotContracts() {
  return [...CHANNEL_BOT_CONTRACTS];
}

export function requireChannelBotContract(channel: ChannelId) {
  const contract = CHANNEL_BOT_CONTRACTS.find((entry) => entry.channel === channel);
  if (!contract) {
    throw new Error(`Unsupported channel bot contract: ${channel}`);
  }
  return contract;
}

function getChannelManagedProviderConfig(
  config: ClisbotConfig,
  channel: ChannelId,
) : ChannelProviderConfig {
  return config.bots[requireChannelBotContract(channel).configBotKey] as ChannelProviderConfig;
}

export function listChannelBotContractIds() {
  return CHANNEL_BOT_CONTRACTS.map((entry) => entry.channel);
}

export function getChannelBotRecords(
  config: ClisbotConfig,
  channel: ChannelId,
): Record<string, ChannelManagedBotConfig | undefined> {
  const providerConfig = getChannelManagedProviderConfig(config, channel);
  const { defaults, ...bots } = providerConfig;
  return bots as Record<string, ChannelManagedBotConfig | undefined>;
}

export function getChannelManagedProviderDefaults(
  config: ClisbotConfig,
  channel: ChannelId,
): ChannelManagedProviderDefaults {
  return getChannelManagedProviderConfig(config, channel).defaults as ChannelManagedProviderDefaults;
}

export function listChannelManagedProviderDefaults(config: ClisbotConfig) {
  return CHANNEL_BOT_CONTRACTS.map((contract) => ({
    channel: contract.channel,
    defaults: getChannelManagedProviderDefaults(config, contract.channel),
  }));
}

export function getChannelManagedBotRecord(
  config: ClisbotConfig,
  channel: ChannelId,
  botId: string,
) {
  return getChannelBotRecords(config, channel)[botId];
}

export function deleteChannelManagedBotRecord(
  config: ClisbotConfig,
  channel: ChannelId,
  botId: string,
) {
  delete getChannelBotRecords(config, channel)[botId];
}

export function countChannelManagedBotRoutes(
  channel: ChannelId,
  bot: ChannelManagedBotConfig,
) {
  return requireChannelBotContract(channel).countManagedBotRoutes(bot);
}

export function resolveConfiguredChannelBotId(
  config: ClisbotConfig,
  channel: ChannelId,
  botId?: string | null,
) {
  return normalizeBotId(botId) ?? getConfiguredDefaultBotId({
    defaultBotId: getChannelManagedProviderDefaults(config, channel).defaultBotId,
    bots: getChannelBotRecords(config, channel),
  });
}
