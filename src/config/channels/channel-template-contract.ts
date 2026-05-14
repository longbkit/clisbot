import type { ChannelId } from "../../channels/integration/channel-surface-contract.ts";
import { CHANNEL_TEMPLATE_CONTRACTS } from "../../channels/integration/channel-installation-inventory.ts";
import type { ChannelTemplateContract } from "./channel-template-defaults.ts";

export {
  createChannelDefaultBotTemplate,
  createStandardChannelProviderDefaultsTemplate,
  createTopicChannelProviderDefaultsTemplate,
  defineChannelTemplateContract,
  type ChannelBootstrapTemplateOptions,
  type ChannelTemplateConfigKey,
  type ChannelTemplateConfigMap,
  type ChannelTemplateContract,
} from "./channel-template-defaults.ts";

export function listChannelTemplateContracts() {
  return [...CHANNEL_TEMPLATE_CONTRACTS];
}

export function requireChannelTemplateContract(channel: ChannelId) {
  const contract = CHANNEL_TEMPLATE_CONTRACTS.find((entry) => entry.channel === channel);
  if (!contract) {
    throw new Error(`Unsupported channel template contract: ${channel}`);
  }
  return contract as ChannelTemplateContract;
}
