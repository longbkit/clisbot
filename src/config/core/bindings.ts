import type { LoadedConfig } from "./load-config.ts";
import type { ClisbotConfig } from "./schema.ts";
import {
  getChannelBotRecord,
  resolveChannelBotId,
} from "../channels/channel-bots.ts";
import { resolveProvidedBotId } from "../channels/channel-bot-records.ts";
import type { ChannelId } from "../../channels/integration/channel-surface-contract.ts";

export type BindingMatch = {
  channel: ChannelId;
  botId?: string;
  accountId?: string;
};

export function formatBinding(match: BindingMatch) {
  const botId = resolveProvidedBotId(match);
  return botId ? `${match.channel}:${botId}` : match.channel;
}

function getRawConfig(config: LoadedConfig | ClisbotConfig) {
  return "raw" in config ? config.raw : config;
}

export function resolveBoundAgentId(
  config: LoadedConfig | ClisbotConfig,
  match: BindingMatch,
): string | null {
  const raw = getRawConfig(config);
  const requestedBotId = resolveProvidedBotId(match);
  const botId = resolveChannelBotId(raw, match.channel, requestedBotId);
  return getChannelBotRecord(raw, match.channel, botId)?.agentId ?? null;
}

export function resolveTopLevelBoundAgentId(
  config: LoadedConfig | ClisbotConfig,
  match: BindingMatch,
): string | null {
  return resolveBoundAgentId(config, match);
}
