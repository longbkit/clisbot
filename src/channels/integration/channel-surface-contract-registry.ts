import { CHANNEL_SURFACE_CONTRACTS } from "./channel-installation-inventory.ts";
import {
  buildChannelPrincipal,
  type ChannelId,
  type ChannelSurfaceContract,
} from "./channel-surface-contract.ts";

export function getChannelSurfaceContract(channel: ChannelId): ChannelSurfaceContract {
  const contract = CHANNEL_SURFACE_CONTRACTS.find((entry) => entry.channel === channel);
  if (!contract) {
    throw new Error(`Unsupported channel surface contract: ${channel}`);
  }
  return contract;
}

export function isKnownChannelId(value: string): value is ChannelId {
  return CHANNEL_SURFACE_CONTRACTS.some((contract) => contract.channel === value);
}

export function normalizeChannelUserId(
  channel: ChannelId,
  providerUserId: string,
) {
  const normalized = getChannelSurfaceContract(channel).normalizeUserId(providerUserId);
  return normalized || "";
}

export function buildNormalizedChannelPrincipal(
  channel: ChannelId,
  providerUserId: string,
) {
  return buildChannelPrincipal(channel, normalizeChannelUserId(channel, providerUserId));
}

export function renderChannelRouteIdSyntax(channel: ChannelId) {
  return getChannelSurfaceContract(channel).routeIdSyntax;
}

export function channelSupportsRouteTopics(channel: ChannelId) {
  return getChannelSurfaceContract(channel).supportsTopics;
}

export function channelSupportsRouteGroups(channel: ChannelId) {
  return getChannelSurfaceContract(channel).supportsGroups;
}

export function isLegacyGroupRouteAlias(channel: ChannelId, kind: string) {
  return getChannelSurfaceContract(channel).legacyGroupAliases.includes(kind);
}

export function renderCanonicalRouteIdList() {
  return "`dm:<id>`, `dm:*`, `group:<id>`, `group:*`, and `topic:<chatId>:<topicId>`";
}

export function renderLegacyCompatibleRouteInputList(channel?: ChannelId) {
  const routeAliases = new Set<string>();
  for (const contract of CHANNEL_SURFACE_CONTRACTS) {
    if (channel && contract.channel !== channel) {
      continue;
    }
    if (!contract.supportsGroups) {
      continue;
    }
    routeAliases.add("groups:*");
    for (const alias of contract.legacyGroupAliases) {
      routeAliases.add(`${alias}:<id>`);
    }
  }
  return Array.from(routeAliases)
    .map((alias) => `\`${alias}\``)
    .join(" and ");
}
