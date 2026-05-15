import type { BotRouteConfig, ClisbotConfig } from "../core/schema.ts";
import type { ChannelId } from "../../channels/integration/channel-surface-contract.ts";
import { CHANNEL_ROUTE_CONTRACTS } from "../../channels/integration/channel-installation-inventory.ts";
import { createTopicChannelRouteShell } from "./channel-route-shells.ts";
import type {
  ChannelBotRecord,
  ChannelConfigBotKey,
  ChannelGroupRoute,
  ChannelProviderConfig,
} from "./channel-config-shapes.ts";

export type ChannelRouteBotConfig = ChannelBotRecord;
export type ChannelRouteGroupConfig = ChannelGroupRoute;
export type ChannelConversationPolicy = "open" | "allowlist" | "disabled";

export type ChannelLegacyGroupPolicyAccess = {
  read(owner: Record<string, unknown>): unknown;
  write(owner: Record<string, unknown>, policy: ChannelConversationPolicy): void;
};

export type ChannelRouteContract = {
  channel: ChannelId;
  configBotKey: ChannelConfigBotKey;
  providerLabel: string;
  supportsGroups: boolean;
  supportsTopics: boolean;
  legacyGroupPolicy?: ChannelLegacyGroupPolicyAccess;
  createGroupRouteShell(policy?: BotRouteConfig["policy"]): ChannelRouteGroupConfig;
  createTopicRouteShell?(base?: Pick<BotRouteConfig, "enabled" | "requireMention" | "allowBots">): BotRouteConfig;
};

export {
  createStandardChannelGroupRouteShell,
  createTopicAwareChannelGroupRouteShell,
  createTopicChannelRouteShell,
} from "./channel-route-shells.ts";

export function listChannelRouteContracts() {
  return [...CHANNEL_ROUTE_CONTRACTS];
}

export function requireChannelRouteContract(channel: ChannelId) {
  const contract = CHANNEL_ROUTE_CONTRACTS.find((entry) => entry.channel === channel);
  if (!contract) {
    throw new Error(`Unsupported channel route contract: ${channel}`);
  }
  return contract;
}

export function getChannelRouteProviderConfig(
  config: ClisbotConfig,
  channel: ChannelId,
): ChannelProviderConfig {
  const contract = requireChannelRouteContract(channel);
  return config.bots[contract.configBotKey] as ChannelProviderConfig;
}

export function getChannelRouteBotRecords(
  config: ClisbotConfig,
  channel: ChannelId,
): Record<string, ChannelRouteBotConfig | undefined> {
  const providerConfig = getChannelRouteProviderConfig(config, channel);
  const { defaults, ...bots } = providerConfig;
  return bots as Record<string, ChannelRouteBotConfig | undefined>;
}

export function getChannelRouteBotRecord(
  config: ClisbotConfig,
  channel: ChannelId,
  botId: string,
) {
  return getChannelRouteBotRecords(config, channel)[botId];
}

export function createChannelGroupRouteShell(
  channel: ChannelId,
  policy?: BotRouteConfig["policy"],
) {
  return requireChannelRouteContract(channel).createGroupRouteShell(policy);
}

export function createChannelTopicRouteShell(
  channel: ChannelId,
  base?: Pick<BotRouteConfig, "enabled" | "requireMention" | "allowBots">,
) {
  const createTopicRouteShell = requireChannelRouteContract(channel).createTopicRouteShell;
  if (!createTopicRouteShell) {
    throw new Error(`Channel does not support topic routes: ${channel}`);
  }
  return createTopicRouteShell(base);
}

export function channelSupportsTopicRoutes(channel: ChannelId) {
  return requireChannelRouteContract(channel).supportsTopics;
}

export function channelSupportsGroupRoutes(channel: ChannelId) {
  return requireChannelRouteContract(channel).supportsGroups;
}

export function readChannelLegacyGroupPolicy(
  channel: ChannelId,
  owner: Record<string, unknown>,
) {
  return requireChannelRouteContract(channel).legacyGroupPolicy?.read(owner);
}

export function writeChannelLegacyGroupPolicy(params: {
  channel: ChannelId;
  owner: Record<string, unknown>;
  policy: ChannelConversationPolicy;
}) {
  requireChannelRouteContract(params.channel).legacyGroupPolicy?.write(
    params.owner,
    params.policy,
  );
}
