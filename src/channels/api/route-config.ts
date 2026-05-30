import type { LoadedConfig } from "../../config/core/load-config.ts";
import { resolveProvidedBotId } from "../../config/channels/channel-bot-records.ts";
import type { ChannelGroupRoute } from "../../config/channels/channel-config-shapes.ts";
import {
  buildSurfaceRoute,
  isSurfaceRouteEnabled,
  mergeSurfaceRouteOverride,
  type ResolvedSurfaceRouteStatus,
  type SurfaceRoute,
  type SurfaceRouteOverride,
} from "../config/route-policy.ts";
import {
  resolveApiBotConfig,
  resolveApiDirectMessageConfig,
} from "./config.ts";

export type ApiConversationKind = "dm" | "group";
export type ApiRoute = SurfaceRoute;
export type ApiResolvedRoute = {
  conversationKind: ApiConversationKind;
  route: ApiRoute | null;
  status: ResolvedSurfaceRouteStatus;
};

function resolveSharedRouteStatus(route: SurfaceRouteOverride | undefined) {
  if (!route) {
    return "missing" as const;
  }
  return isSurfaceRouteEnabled(route) ? "admitted" as const : "disabled" as const;
}

function buildRoute(
  loadedConfig: LoadedConfig,
  params: {
    botId?: string;
    route?: SurfaceRouteOverride | null;
    policy: "open" | "allowlist";
    requireMention?: boolean;
  },
): ApiRoute {
  const apiConfig = resolveApiBotConfig(
    loadedConfig.raw.bots.api,
    resolveProvidedBotId(params),
  );
  return buildSurfaceRoute({
    loadedConfig,
    channel: "api",
    channelConfig: apiConfig,
    route: params.route,
    policy: params.policy,
    requireMention: params.requireMention ?? false,
  });
}

function resolveDirectMessageRoute(
  loadedConfig: LoadedConfig,
  surfaceId: string,
  botId?: string,
) {
  const resolvedBotId = resolveProvidedBotId({ botId });
  const apiConfig = resolveApiBotConfig(loadedConfig.raw.bots.api, resolvedBotId);
  const route = resolveApiDirectMessageConfig(apiConfig, surfaceId);
  if (!isSurfaceRouteEnabled(route)) {
    return null;
  }
  return buildRoute(loadedConfig, {
    botId: resolvedBotId,
    route,
    policy: route?.policy === "open" ? "open" : "allowlist",
  });
}

function resolveGroupRoute(
  loadedConfig: LoadedConfig,
  surfaceId: string,
  botId?: string,
) {
  const resolvedBotId = resolveProvidedBotId({ botId });
  const apiConfig = resolveApiBotConfig(loadedConfig.raw.bots.api, resolvedBotId);
  if (apiConfig.groupPolicy === "disabled") {
    return { route: null, status: "disabled" as const };
  }
  const exactRoute = apiConfig.groups[surfaceId] as ChannelGroupRoute | undefined;
  if (apiConfig.groupPolicy === "allowlist" && !exactRoute) {
    return { route: null, status: "missing" as const };
  }
  const route = mergeSurfaceRouteOverride(apiConfig.groups["*"], exactRoute);
  const status = resolveSharedRouteStatus(route);
  if (status !== "admitted") {
    return { route: null, status };
  }
  return {
    route: buildRoute(loadedConfig, {
      botId: resolvedBotId,
      route,
      policy: route?.policy === "allowlist" ? "allowlist" : "open",
    }),
    status,
  };
}

export function resolveApiConversationRoute(params: {
  loadedConfig: LoadedConfig;
  botId: string;
  surfaceKind: ApiConversationKind;
  surfaceId: string;
}): ApiResolvedRoute {
  if (params.surfaceKind === "dm") {
    const route = resolveDirectMessageRoute(
      params.loadedConfig,
      params.surfaceId,
      params.botId,
    );
    return {
      conversationKind: "dm",
      route,
      status: route ? "admitted" : "disabled",
    };
  }
  const group = resolveGroupRoute(params.loadedConfig, params.surfaceId, params.botId);
  return {
    conversationKind: "group",
    route: group.route,
    status: group.status,
  };
}
