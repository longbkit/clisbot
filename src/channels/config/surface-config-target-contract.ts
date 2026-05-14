import {
  createDirectMessageBehaviorOverride,
  resolveDirectMessageExactRoute,
  resolveDirectMessageWildcardRoute,
} from "../../config/channels/direct-message-route-resolution.ts";
import {
  getChannelProviderBotRecords,
  getConfiguredDefaultBotId,
  normalizeBotId,
} from "../../config/channels/channel-bot-records.ts";
import type {
  ChannelBotRecord,
  ChannelConfigBotKey,
  ChannelProviderConfig,
} from "../../config/channels/channel-config-shapes.ts";
import type { ClisbotConfig } from "../../config/core/schema.ts";
import type { ChannelId } from "../integration/channel-surface-contract.ts";
import type { ChannelIdentity } from "../surface/channel-identity.ts";

export type ConfiguredSurfaceTarget = {
  channel: ChannelId;
  botId?: string;
  target?: string;
};

export type SurfaceTargetScope = "conversation" | "channel";

export type SurfaceConfigTargetBinding = {
  label: string;
  getExactSource(): Record<string, unknown> | undefined;
  getFallbackSources(): Array<Record<string, unknown> | undefined>;
  ensureWritableSource(): Record<string, unknown>;
};

export type ChannelSurfaceConfigTargetContract = {
  channel: ChannelId;
  resolveConfiguredSurfaceTargetBinding(
    config: ClisbotConfig,
    params: ConfiguredSurfaceTarget,
  ): SurfaceConfigTargetBinding;
  buildConfiguredTargetFromIdentity(
    identity: ChannelIdentity,
    options?: {
      scope?: SurfaceTargetScope;
    },
  ): ConfiguredSurfaceTarget;
};

export function resolveSurfaceTargetBot(params: {
  config: ClisbotConfig;
  configBotKey: ChannelConfigBotKey;
  channel: ChannelId;
  botId?: string | null;
}) {
  const providerConfig = params.config.bots[params.configBotKey] as ChannelProviderConfig;
  const botRecords = getChannelProviderBotRecords(providerConfig);
  const resolvedBotId =
    normalizeBotId(params.botId) ??
    getConfiguredDefaultBotId({
      defaultBotId: providerConfig.defaults.defaultBotId,
      bots: botRecords,
    });
  const bot = botRecords[resolvedBotId];
  if (!bot) {
    throw new Error(`Unknown bot: ${params.channel}/${resolvedBotId}`);
  }
  return {
    botId: resolvedBotId,
    bot: bot as ChannelBotRecord,
  };
}

export function resolveDirectMessageTargetBinding(params: {
  channel: ChannelId;
  targetId: string;
  bot: Record<string, unknown> & {
    directMessages: Record<string, Record<string, unknown>>;
  };
}): SurfaceConfigTargetBinding {
  const normalizedTargetId = params.targetId.trim();
  if (!normalizedTargetId) {
    throw new Error(`${params.channel} target must use dm:<id|*>.`);
  }

  const routeKey = normalizedTargetId === "*" ? "*" : normalizedTargetId;
  return {
    label: `${params.channel} dm:${normalizedTargetId}`,
    getExactSource: () => resolveDirectMessageExactRoute(params.bot.directMessages, normalizedTargetId),
    getFallbackSources: () => [
      resolveDirectMessageWildcardRoute(params.bot.directMessages),
      params.bot,
    ],
    ensureWritableSource: () => {
      const existing = resolveDirectMessageExactRoute(params.bot.directMessages, normalizedTargetId);
      if (existing) {
        return existing;
      }
      const created = createDirectMessageBehaviorOverride(
        resolveDirectMessageWildcardRoute(params.bot.directMessages),
      );
      params.bot.directMessages[routeKey] = created;
      return created;
    },
  };
}
