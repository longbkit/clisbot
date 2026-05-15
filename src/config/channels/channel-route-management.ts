import type {
  BotRouteConfig,
  ClisbotConfig,
} from "../core/schema.ts";
import {
  listChannelBotEntries,
  requireChannelBotRecord,
} from "./channel-bots.ts";
import {
  createDirectMessageBehaviorOverride,
  ensureBotDirectMessageWildcardRoute,
  normalizeDirectMessageRouteId,
} from "./direct-message-routes.ts";
import {
  getSharedGroupsWildcardRouteId,
  isSharedGroupsWildcardRouteId,
  normalizeSharedGroupRouteId,
} from "./group-routes.ts";
import {
  createChannelGroupRouteShell,
  createChannelTopicRouteShell,
} from "./channel-route-contract.ts";
import {
  channelSupportsRouteTopics,
  channelSupportsRouteGroups,
  isLegacyGroupRouteAlias,
  renderChannelRouteIdSyntax,
} from "../../channels/integration/channel-surface-contract-registry.ts";
import {
  renderDefaultChannelLabel,
  type ChannelId,
} from "../../channels/integration/channel-surface-contract.ts";
import type {
  ChannelBotRecord,
  ChannelGroupRoute,
} from "./channel-config-shapes.ts";

export type Provider = ChannelId;
export type RouteNode =
  | BotRouteConfig
  | ChannelGroupRoute;

export type ParsedRouteId =
  | {
      provider: Provider;
      routeId: string;
      storage: "groups";
      key: string;
      kind: "group";
    }
  | {
      provider: Provider;
      routeId: string;
      storage: "groups";
      key: string;
      kind: "group" | "topic";
      topicId?: string;
    }
  | {
      provider: Provider;
      routeId: string;
      storage: "directMessages";
      key: string;
      kind: "dm";
    };

export type ConfiguredRouteRow = {
  channel: Provider;
  botId: string;
  routeId: string;
  kind: "shared" | "group" | "topic" | "dm";
  route: RouteNode;
};

type CreateRouteOptions = {
  create?: boolean;
  policy?: BotRouteConfig["policy"];
};

function createBaseRoute(kind: ParsedRouteId["kind"], policy?: string): BotRouteConfig {
  const route: BotRouteConfig = {
    enabled: kind !== "group" ? true : policy !== "disabled",
    requireMention: kind === "dm" ? false : true,
    allowUsers: [],
    blockUsers: [],
    allowBots: false,
  };
  if (policy) {
    route.policy = policy as BotRouteConfig["policy"];
  }
  return route;
}

function createDirectMessageRoute(
  config: ClisbotConfig,
  provider: Provider,
  botId: string,
  policy?: string,
) {
  const wildcardRoute = ensureBotDirectMessageWildcardRoute(config, provider, botId);
  const route = createDirectMessageBehaviorOverride(wildcardRoute);
  if (policy) {
    route.policy = policy as BotRouteConfig["policy"];
  }
  return route;
}

function renderRouteId(params: {
  provider: Provider;
  storage: "groups" | "directMessages";
  key: string;
  topicId?: string;
}) {
  if (params.storage === "directMessages") {
    return params.key === "*" ? "dm:*" : `dm:${params.key}`;
  }
  if (params.key === getSharedGroupsWildcardRouteId()) {
    return "group:*";
  }
  if (channelSupportsRouteTopics(params.provider) && params.topicId) {
    return `topic:${params.key}:${params.topicId}`;
  }
  return `group:${params.key}`;
}

function getRouteContainer(
  config: ClisbotConfig,
  provider: Provider,
  botId: string,
) : ChannelBotRecord {
  return requireChannelBotRecord(config, provider, botId);
}

function getTopicGroupRoute(
  config: ClisbotConfig,
  provider: Provider,
  botId: string,
  parsed: ParsedRouteId,
  options: CreateRouteOptions,
) {
  const bot = getRouteContainer(config, provider, botId);
  if (!bot.groups[parsed.key] && options.create) {
    const createdGroup = createChannelGroupRouteShell(
      provider,
      parsed.kind === "topic" ? undefined : options.policy,
    );
    if (!options.policy) {
      delete createdGroup.policy;
    }
    bot.groups[parsed.key] = createdGroup;
  }
  const group = bot.groups[parsed.key];
  if (!group) {
    return undefined;
  }
  if (parsed.kind !== "topic" || !parsed.topicId) {
    return group;
  }
  group.topics ??= {};
  if (!group.topics[parsed.topicId] && options.create) {
    group.topics[parsed.topicId] = {
      ...createChannelTopicRouteShell(provider, group),
      ...(options.policy ? { policy: options.policy as BotRouteConfig["policy"] } : {}),
    };
  }
  return group.topics[parsed.topicId];
}

export function ensureProviderBot(
  config: ClisbotConfig,
  provider: Provider,
  botId: string,
) {
  return requireChannelBotRecord(config, provider, botId);
}

export function parseChannelRouteId(provider: Provider, raw: string | undefined): ParsedRouteId {
  const routeId = raw?.trim();
  if (!routeId) {
    throw new Error(`${renderDefaultChannelLabel(provider)} route ids must use ${renderChannelRouteIdSyntax(provider)}.`);
  }

  const supportsGroups = channelSupportsRouteGroups(provider);
  if (
    supportsGroups &&
    (routeId === "*" || routeId === "group:*" || isSharedGroupsWildcardRouteId(routeId))
  ) {
    return {
      provider,
      routeId: "group:*",
      storage: "groups",
      key: getSharedGroupsWildcardRouteId(),
      kind: "group",
    };
  }

  const [kind, first, second] = routeId.split(":", 3);
  if (kind === "dm" && first?.trim()) {
    return {
      provider,
      routeId: first.trim() === "*" ? "dm:*" : `dm:${first.trim()}`,
      storage: "directMessages",
      key: normalizeDirectMessageRouteId(first.trim()),
      kind: "dm",
    };
  }

  if (kind === "topic" && channelSupportsRouteTopics(provider) && first?.trim() && second?.trim()) {
    return {
      provider,
      routeId: `topic:${first.trim()}:${second.trim()}`,
      storage: "groups",
      key: first.trim(),
      topicId: second.trim(),
      kind: "topic",
    };
  }

  if (
    supportsGroups &&
    (kind === "group" || isLegacyGroupRouteAlias(provider, kind ?? "")) &&
    first?.trim()
  ) {
    return {
      provider,
      routeId: `group:${first.trim()}`,
      storage: "groups",
      key: normalizeSharedGroupRouteId(provider, `${kind}:${first.trim()}`),
      kind: "group",
    };
  }

  throw new Error(`${renderDefaultChannelLabel(provider)} route ids must use ${renderChannelRouteIdSyntax(provider)}.`);
}

export function getOrCreateRoute(
  config: ClisbotConfig,
  provider: Provider,
  botId: string,
  parsed: ParsedRouteId,
  options: CreateRouteOptions = {},
): RouteNode | undefined {
  if (parsed.storage === "directMessages") {
    const bot = getRouteContainer(config, provider, botId);
    bot.directMessages ??= {};
    if (!bot.directMessages[parsed.key] && options.create) {
      const createdRoute = createDirectMessageRoute(
        config,
        provider,
        botId,
        options.policy,
      );
      bot.directMessages[parsed.key] = createdRoute;
      return createdRoute;
    }
    return bot.directMessages[parsed.key];
  }

  if (channelSupportsRouteTopics(provider)) {
    return getTopicGroupRoute(config, provider, botId, parsed, options);
  }

  const bot = getRouteContainer(config, provider, botId);
  if (!bot.groups[parsed.key] && options.create) {
    bot.groups[parsed.key] = createBaseRoute(parsed.kind, options.policy);
  }
  return bot.groups[parsed.key];
}

export function ensureRoute(
  config: ClisbotConfig,
  provider: Provider,
  botId: string,
  parsed: ParsedRouteId,
) {
  const route = getOrCreateRoute(config, provider, botId, parsed);
  if (!route) {
    throw new Error(`Unknown route: ${provider}/${botId}/${parsed.routeId}`);
  }
  return route;
}

export function removeRouteFromConfig(
  config: ClisbotConfig,
  provider: Provider,
  botId: string,
  parsed: ParsedRouteId,
) {
  const bot = getRouteContainer(config, provider, botId);
  if (parsed.storage === "directMessages") {
    delete bot.directMessages[parsed.key];
    return;
  }
  if (channelSupportsRouteTopics(provider) && parsed.kind === "topic" && parsed.topicId) {
    delete bot.groups[parsed.key]?.topics?.[parsed.topicId];
    return;
  }
  delete bot.groups[parsed.key];
}

export function listConfiguredRoutes(
  config: ClisbotConfig,
  provider?: Provider,
  botIdFilter?: string,
) {
  const rows: ConfiguredRouteRow[] = [];
  for (const entry of listChannelBotEntries(config, provider)) {
    if (botIdFilter && entry.botId !== botIdFilter) {
      continue;
    }
    if (channelSupportsRouteGroups(entry.channel)) {
      for (const [key, route] of Object.entries(entry.bot.groups ?? {})) {
        rows.push({
          channel: entry.channel,
          botId: entry.botId,
          routeId: renderRouteId({ provider: entry.channel, storage: "groups", key }),
          kind: key === getSharedGroupsWildcardRouteId() ? "shared" : "group",
          route: route as RouteNode,
        });
        if (!channelSupportsRouteTopics(entry.channel)) {
          continue;
        }
        for (const [topicId, topic] of Object.entries((route as ChannelGroupRoute).topics ?? {})) {
          rows.push({
            channel: entry.channel,
            botId: entry.botId,
            routeId: renderRouteId({
              provider: entry.channel,
              storage: "groups",
              key,
              topicId,
            }),
            kind: "topic",
            route: topic,
          });
        }
      }
    }
    for (const [key, route] of Object.entries(entry.bot.directMessages ?? {})) {
      rows.push({
        channel: entry.channel,
        botId: entry.botId,
        routeId: renderRouteId({ provider: entry.channel, storage: "directMessages", key }),
        kind: "dm",
        route,
      });
    }
  }

  return rows;
}
