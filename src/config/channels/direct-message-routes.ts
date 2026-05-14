import type {
  BotRouteConfig,
  ClisbotConfig,
} from "../core/schema.ts";
import type { ChannelId } from "../../channels/integration/channel-surface-contract.ts";
import {
  getChannelRouteBotRecord,
  listChannelRouteContracts,
  requireChannelRouteContract,
} from "./channel-route-contract.ts";
import {
  createDirectMessageRouteShell,
  DIRECT_MESSAGE_WILDCARD_ROUTE_ID,
  LEGACY_DIRECT_MESSAGE_WILDCARD_ROUTE_IDS,
  mergeDirectMessageRoute,
  resolveDirectMessageExactRoute,
  resolveEffectiveDirectMessageRoute,
  resolveDirectMessageWildcardRoute,
  stripDirectMessageAdmissionFields,
} from "./direct-message-route-resolution.ts";

type DirectMessageRouteOwner = {
  directMessages: Record<string, BotRouteConfig>;
};

type Provider = ChannelId;

export function isDirectMessageWildcardRouteId(routeId: string) {
  const normalized = routeId.trim();
  return (
    normalized === DIRECT_MESSAGE_WILDCARD_ROUTE_ID ||
    LEGACY_DIRECT_MESSAGE_WILDCARD_ROUTE_IDS.includes(normalized)
  );
}

export function normalizeDirectMessageRouteId(routeId: string) {
  const normalized = routeId.trim();
  if (!normalized) {
    return "";
  }
  if (isDirectMessageWildcardRouteId(normalized)) {
    return DIRECT_MESSAGE_WILDCARD_ROUTE_ID;
  }
  if (normalized.startsWith("dm:")) {
    return normalized.slice(3).trim();
  }
  return normalized;
}

export function isExactDirectMessageRouteId(routeId: string) {
  const normalized = normalizeDirectMessageRouteId(routeId);
  return Boolean(normalized && normalized !== DIRECT_MESSAGE_WILDCARD_ROUTE_ID);
}

function orderWildcardFirst<TRoute>(
  routes: Record<string, TRoute>,
) {
  const wildcard = routes[DIRECT_MESSAGE_WILDCARD_ROUTE_ID];
  if (!wildcard) {
    return routes;
  }
  return {
    [DIRECT_MESSAGE_WILDCARD_ROUTE_ID]: wildcard,
    ...Object.fromEntries(
      Object.entries(routes).filter(([routeId]) => routeId !== DIRECT_MESSAGE_WILDCARD_ROUTE_ID),
    ),
  };
}

function normalizeDirectMessageRouteMap(params: {
  owner: DirectMessageRouteOwner;
  exactAdmissionMode: "inherit" | "explicit";
}) {
  const nextRoutes: Record<string, BotRouteConfig> = {};

  for (const [routeId, route] of Object.entries(params.owner.directMessages ?? {})) {
    const normalizedRouteId = normalizeDirectMessageRouteId(routeId);
    if (!normalizedRouteId) {
      continue;
    }

    const normalizedRoute =
      params.exactAdmissionMode === "inherit" && normalizedRouteId !== DIRECT_MESSAGE_WILDCARD_ROUTE_ID
        ? stripDirectMessageAdmissionFields(route) ?? {}
        : route;

    nextRoutes[normalizedRouteId] = {
      ...createDirectMessageRouteShell(),
      ...mergeDirectMessageRoute(nextRoutes[normalizedRouteId], normalizedRoute as BotRouteConfig),
    };
  }

  params.owner.directMessages = orderWildcardFirst(nextRoutes);
}

function normalizeProviderDirectMessageRoutes<TConfig extends {
  defaults: DirectMessageRouteOwner;
}>(params: {
  providerConfig: TConfig;
  exactAdmissionMode: "inherit" | "explicit";
}) {
  normalizeDirectMessageRouteMap({
    owner: params.providerConfig.defaults,
    exactAdmissionMode: "explicit",
  });

  for (const [botId, botConfig] of Object.entries(params.providerConfig)) {
    if (botId === "defaults") {
      continue;
    }
    normalizeDirectMessageRouteMap({
      owner: botConfig as DirectMessageRouteOwner,
      exactAdmissionMode: params.exactAdmissionMode,
    });
  }
}

export function normalizeConfigDirectMessageRoutes(
  config: ClisbotConfig,
  options: {
    exactAdmissionMode?: "inherit" | "explicit";
  } = {},
) {
  const exactAdmissionMode = options.exactAdmissionMode ?? "explicit";
  for (const contract of listChannelRouteContracts()) {
    normalizeProviderDirectMessageRoutes({
      providerConfig: config.bots[contract.configBotKey],
      exactAdmissionMode,
    });
  }
  return config;
}

function getProviderBot(
  config: ClisbotConfig,
  provider: Provider,
  botId: string,
){
  const bot = getChannelRouteBotRecord(config, provider, botId);
  if (!bot) {
    throw new Error(`Unknown ${requireChannelRouteContract(provider).providerLabel} bot: ${botId}`);
  }
  return bot;
}

export function ensureBotDirectMessageWildcardRoute(
  config: ClisbotConfig,
  provider: Provider,
  botId: string,
  policy: BotRouteConfig["policy"] = "pairing",
) {
  const bot = getProviderBot(config, provider, botId);
  const wildcardRoute = resolveDirectMessageWildcardRoute(bot.directMessages);
  if (wildcardRoute) {
    if (!bot.directMessages[DIRECT_MESSAGE_WILDCARD_ROUTE_ID]) {
      bot.directMessages[DIRECT_MESSAGE_WILDCARD_ROUTE_ID] = {
        ...createDirectMessageRouteShell(policy),
        ...wildcardRoute,
      };
      for (const legacyRouteId of LEGACY_DIRECT_MESSAGE_WILDCARD_ROUTE_IDS) {
        delete bot.directMessages[legacyRouteId];
      }
    }
    bot.directMessages = orderWildcardFirst(bot.directMessages);
    return bot.directMessages[DIRECT_MESSAGE_WILDCARD_ROUTE_ID]!;
  }

  const createdRoute = createDirectMessageRouteShell(policy);
  bot.directMessages = {
    [DIRECT_MESSAGE_WILDCARD_ROUTE_ID]: createdRoute,
    ...bot.directMessages,
  };
  return createdRoute;
}

export {
  createDirectMessageBehaviorOverride,
  createDirectMessageRouteShell,
  DIRECT_MESSAGE_WILDCARD_ROUTE_ID,
  LEGACY_DIRECT_MESSAGE_WILDCARD_ROUTE_IDS,
  resolveDirectMessageExactRoute,
  resolveEffectiveDirectMessageRoute,
  resolveDirectMessageWildcardRoute,
} from "./direct-message-route-resolution.ts";
