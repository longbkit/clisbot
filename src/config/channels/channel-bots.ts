import type { ClisbotConfig } from "../core/schema.ts";
import type { ChannelId } from "../../channels/integration/channel-surface-contract.ts";
import {
  countChannelManagedBotRoutes,
  deleteChannelManagedBotRecord,
  getChannelBotRecords,
  getChannelManagedBotRecord,
  getChannelManagedProviderDefaults,
  listChannelBotContractIds,
  resolveConfiguredChannelBotId,
  type ChannelManagedBotConfig,
  type ChannelManagedProviderDefaults,
} from "./channel-bot-contract.ts";
import { listEnabledBotIds } from "./channel-bot-records.ts";
export {
  listEnabledChannelProviderBotIds,
  mergeResolvedChannelBotConfig,
  mergeStandardChannelGroupRoutes,
  mergeTopicAwareChannelGroupRoutes,
  requireChannelProviderBotRecord,
  resolveChannelDirectMessageAdmissionConfig,
  resolveChannelDirectMessageConfig,
  resolveChannelProviderBotConfig,
  resolveChannelProviderBotId,
  type ResolvedChannelBotConfig,
} from "./channel-bot-resolution.ts";

// Canonical bot-oriented config helpers live here.

export type ChannelBotEntry = {
  channel: ChannelId;
  botId: string;
  bot: ChannelManagedBotConfig;
};

export type ChannelBotSummary = {
  channel: ChannelId;
  botId: string;
  enabled: boolean;
  agentId?: string;
  credentialType: string;
  routeCount: number;
};

export function listChannelBotEntries(
  config: ClisbotConfig,
  channel?: ChannelId,
): ChannelBotEntry[] {
  const channels = channel ? [channel] : listChannelBotContractIds();
  return channels.flatMap((currentChannel) =>
    Object.entries(getChannelBotRecords(config, currentChannel))
      .filter(([, bot]) => Boolean(bot))
      .map(([botId, bot]) => ({
        channel: currentChannel,
        botId,
        bot: bot!,
      })),
  );
}

export function summarizeChannelBotEntry(entry: ChannelBotEntry): ChannelBotSummary {
  return {
    channel: entry.channel,
    botId: entry.botId,
    enabled: entry.bot.enabled !== false,
    agentId: typeof entry.bot.agentId === "string" ? entry.bot.agentId : undefined,
    credentialType: typeof entry.bot.credentialType === "string" ? entry.bot.credentialType : "env",
    routeCount: countChannelManagedBotRoutes(entry.channel, entry.bot),
  };
}

export function listChannelBotSummaries(
  config: ClisbotConfig,
  channel?: ChannelId,
) {
  return listChannelBotEntries(config, channel).map(summarizeChannelBotEntry);
}

export function listConfiguredChannelBotIds(
  config: ClisbotConfig,
  channel: ChannelId,
) {
  return listChannelBotEntries(config, channel).map((entry) => entry.botId);
}

export function getChannelProviderDefaults(
  config: ClisbotConfig,
  channel: ChannelId,
): ChannelManagedProviderDefaults {
  return getChannelManagedProviderDefaults(config, channel);
}

export function getChannelBotRecord(
  config: ClisbotConfig,
  channel: ChannelId,
  botId: string,
): ChannelManagedBotConfig | undefined {
  return getChannelManagedBotRecord(config, channel, botId);
}

export function requireChannelBotRecord(
  config: ClisbotConfig,
  channel: ChannelId,
  botId: string,
): ChannelManagedBotConfig {
  const bot = getChannelBotRecord(config, channel, botId);
  if (!bot) {
    throw new Error(`Unknown bot: ${channel}/${botId}`);
  }
  return bot;
}

export function deleteChannelBotRecord(
  config: ClisbotConfig,
  channel: ChannelId,
  botId: string,
) {
  deleteChannelManagedBotRecord(config, channel, botId);
}

export function resolveChannelBotId(
  config: ClisbotConfig,
  channel: ChannelId,
  botId?: string | null,
) {
  return resolveConfiguredChannelBotId(config, channel, botId);
}

export function reconcileChannelProviderDefaults(
  config: ClisbotConfig,
  channel: ChannelId,
) {
  const defaults = getChannelProviderDefaults(config, channel);
  const enabledBotIds = listEnabledBotIds(
    Object.fromEntries(
      listChannelBotEntries(config, channel).map(({ botId, bot }) => [botId, bot]),
    ),
  );
  defaults.enabled = enabledBotIds.length > 0;
  if (enabledBotIds.length === 0) {
    defaults.defaultBotId = "default";
    return;
  }
  if (!enabledBotIds.includes(defaults.defaultBotId)) {
    defaults.defaultBotId = enabledBotIds[0]!;
  }
}

export function resolveChannelBot(
  config: ClisbotConfig,
  channel: ChannelId,
  botId?: string | null,
): ChannelManagedBotConfig {
  const resolvedBotId = resolveChannelBotId(config, channel, botId);
  return requireChannelBotRecord(config, channel, resolvedBotId);
}
