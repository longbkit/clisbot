import type {
  BotRouteConfig,
  ClisbotConfig,
} from "../core/schema.ts";
import {
  channelSupportsRouteTopics,
  isLegacyGroupRouteAlias,
} from "../../channels/integration/channel-surface-contract-registry.ts";
import type { ChannelId } from "../../channels/integration/channel-surface-contract.ts";
import {
  createChannelGroupRouteShell,
  listChannelRouteContracts,
} from "./channel-route-contract.ts";
import type {
  ChannelGroupRoute,
  ChannelTopicRoutes,
} from "./channel-config-shapes.ts";

type GroupRouteOwner<TGroupRoute = unknown> = {
  groups: Record<string, TGroupRoute>;
};

type Provider = ChannelId;

export const SHARED_GROUPS_WILDCARD_ROUTE_ID = "*";
const LEGACY_SHARED_GROUPS_WILDCARD_ROUTE_IDS = ["groups:*", "group:*"];

export function getSharedGroupsWildcardRouteId() {
  return SHARED_GROUPS_WILDCARD_ROUTE_ID;
}

export function isSharedGroupsWildcardRouteId(routeId: string) {
  const normalized = routeId.trim();
  return (
    normalized === SHARED_GROUPS_WILDCARD_ROUTE_ID ||
    LEGACY_SHARED_GROUPS_WILDCARD_ROUTE_IDS.includes(normalized)
  );
}

export function normalizeSharedGroupRouteId(
  provider: Provider,
  routeId: string,
) {
  const normalized = routeId.trim();
  if (!normalized) {
    return "";
  }
  if (isSharedGroupsWildcardRouteId(normalized)) {
    return SHARED_GROUPS_WILDCARD_ROUTE_ID;
  }
  const [kind, rawId] = normalized.split(":", 2);
  if (rawId && (kind === "group" || isLegacyGroupRouteAlias(provider, kind))) {
    return rawId.trim();
  }
  return normalized;
}

function mergeAudienceEntries(...sources: Array<string[] | undefined>) {
  return [...new Set(
    sources.flatMap((source) => (source ?? []).map((entry) => entry.trim()).filter(Boolean)),
  )];
}

function mergeGroupRoute<TGroupRoute extends Record<string, unknown>>(
  base: TGroupRoute | undefined,
  override: TGroupRoute | undefined,
) {
  if (!base) {
    return override ? { ...override } : undefined;
  }
  if (!override) {
    return { ...base };
  }
  return {
    ...base,
    ...override,
    allowUsers: mergeAudienceEntries(
      base.allowUsers as string[] | undefined,
      override.allowUsers as string[] | undefined,
    ),
    blockUsers: mergeAudienceEntries(
      base.blockUsers as string[] | undefined,
      override.blockUsers as string[] | undefined,
    ),
  } satisfies TGroupRoute;
}

export function resolveSharedGroupsWildcardRoute<TGroupRoute>(
  routes: Record<string, TGroupRoute>,
) {
  return routes[SHARED_GROUPS_WILDCARD_ROUTE_ID] ??
    LEGACY_SHARED_GROUPS_WILDCARD_ROUTE_IDS
      .map((routeId) => routes[routeId])
      .find(Boolean);
}

function normalizeTopicRoutes(
  topics: ChannelTopicRoutes | undefined,
) {
  return Object.fromEntries(
    Object.entries(topics ?? {}).flatMap(([topicId, route]) => {
      const normalizedTopicId = topicId.trim();
      return normalizedTopicId ? [[normalizedTopicId, route]] : [];
    }),
  );
}

function orderWildcardFirst<TGroupRoute>(
  routes: Record<string, TGroupRoute>,
) {
  const wildcard = routes[SHARED_GROUPS_WILDCARD_ROUTE_ID];
  if (!wildcard) {
    return routes;
  }
  return {
    [SHARED_GROUPS_WILDCARD_ROUTE_ID]: wildcard,
    ...Object.fromEntries(
      Object.entries(routes).filter(([routeId]) => routeId !== SHARED_GROUPS_WILDCARD_ROUTE_ID),
    ),
  };
}

function normalizeGroupRouteMap<TGroupRoute extends Record<string, unknown>>(params: {
  provider: Provider;
  owner: GroupRouteOwner<TGroupRoute>;
  createRoute: () => TGroupRoute;
}) {
  const nextRoutes: Record<string, TGroupRoute> = {};

  for (const [routeId, route] of Object.entries(params.owner.groups ?? {})) {
    const normalizedRouteId = normalizeSharedGroupRouteId(params.provider, routeId);
    if (!normalizedRouteId) {
      continue;
    }
    const shell = params.createRoute();
    if (
      normalizedRouteId !== SHARED_GROUPS_WILDCARD_ROUTE_ID &&
      !Object.hasOwn(route, "policy")
    ) {
      delete shell.policy;
    }
    const normalizedRoute = {
      ...shell,
      ...route,
      ...(channelSupportsRouteTopics(params.provider)
        ? {
            topics: normalizeTopicRoutes(
              (route as unknown as ChannelGroupRoute).topics,
            ),
          }
        : {}),
    } as TGroupRoute;
    const baseShell = params.createRoute();
    if (
      normalizedRouteId !== SHARED_GROUPS_WILDCARD_ROUTE_ID &&
      !Object.hasOwn(route, "policy")
    ) {
      delete baseShell.policy;
    }
    nextRoutes[normalizedRouteId] = {
      ...baseShell,
      ...mergeGroupRoute(nextRoutes[normalizedRouteId], normalizedRoute),
    };
  }

  params.owner.groups = orderWildcardFirst(nextRoutes);
}

function normalizeProviderGroupRoutes(params: {
  provider: Provider;
  providerConfig: Record<string, unknown> & {
    defaults: GroupRouteOwner<Record<string, unknown>>;
  };
  createRoute: () => Record<string, unknown>;
}) {
  normalizeGroupRouteMap({
    provider: params.provider,
    owner: params.providerConfig.defaults,
    createRoute: params.createRoute,
  });

  for (const [botId, botConfig] of Object.entries(params.providerConfig)) {
    if (botId === "defaults") {
      continue;
    }
    normalizeGroupRouteMap({
      provider: params.provider,
      owner: botConfig as GroupRouteOwner<Record<string, unknown>>,
      createRoute: params.createRoute,
    });
  }
}

function ensureDefaultGroupWildcardRoute<TGroupRoute extends Record<string, unknown>>(params: {
  owner: GroupRouteOwner<TGroupRoute>;
  createRoute: () => TGroupRoute;
}) {
  if (!params.owner.groups || typeof params.owner.groups !== "object") {
    params.owner.groups = {};
  }
  const wildcard = resolveSharedGroupsWildcardRoute(params.owner.groups);
  if (wildcard) {
    if (!params.owner.groups[SHARED_GROUPS_WILDCARD_ROUTE_ID]) {
      params.owner.groups[SHARED_GROUPS_WILDCARD_ROUTE_ID] = {
        ...params.createRoute(),
        ...wildcard,
      };
      for (const legacyRouteId of LEGACY_SHARED_GROUPS_WILDCARD_ROUTE_IDS) {
        delete params.owner.groups[legacyRouteId];
      }
    }
    params.owner.groups = orderWildcardFirst(params.owner.groups);
    return;
  }

  params.owner.groups = {
    [SHARED_GROUPS_WILDCARD_ROUTE_ID]: params.createRoute(),
    ...params.owner.groups,
  };
}

export function normalizeConfigGroupRoutes(config: ClisbotConfig) {
  for (const contract of listChannelRouteContracts()) {
    normalizeProviderGroupRoutes({
      provider: contract.channel,
      providerConfig: config.bots[contract.configBotKey],
      createRoute: () => createChannelGroupRouteShell(contract.channel),
    });
    ensureDefaultGroupWildcardRoute({
      owner: config.bots[contract.configBotKey].defaults,
      createRoute: () => createChannelGroupRouteShell(contract.channel),
    });
  }

  return config;
}
