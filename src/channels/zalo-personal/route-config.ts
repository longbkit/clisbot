import type { LoadedConfig } from "../../config/core/load-config.ts";
import {
  buildSurfaceRoute,
  isSurfaceRouteEnabled,
  mergeSurfaceRouteOverride,
  type ResolvedSurfaceRouteStatus,
  type SurfaceRoute,
  type SurfaceRouteOverride,
} from "../config/route-policy.ts";
import {
  resolveZaloPersonalConfig,
  resolveZaloPersonalDirectMessageConfig,
} from "./config.ts";

export type ZaloPersonalRoute = SurfaceRoute;
export type ZaloPersonalConversationKind = "dm" | "group";
export type ZaloPersonalResolvedRoute = {
  conversationKind: ZaloPersonalConversationKind;
  route: ZaloPersonalRoute | null;
  status: ResolvedSurfaceRouteStatus;
};

function buildRoute(
  loadedConfig: LoadedConfig,
  params: {
    route?: SurfaceRouteOverride | null;
    policy: "open" | "allowlist";
    requireMention: boolean;
    botId?: string;
  },
) {
  const channelConfig = resolveZaloPersonalConfig(
    loadedConfig.raw.bots.zaloPersonal,
    params.botId,
  );
  return buildSurfaceRoute({
    loadedConfig,
    channel: "zalo-personal",
    channelConfig,
    route: params.route,
    policy: params.policy,
    requireMention: params.requireMention,
  });
}

function resolveDirectMessageRoute(
  loadedConfig: LoadedConfig,
  senderId?: string,
  botId?: string,
) {
  const channelConfig = resolveZaloPersonalConfig(loadedConfig.raw.bots.zaloPersonal, botId);
  const route = resolveZaloPersonalDirectMessageConfig(channelConfig, senderId);
  if (!isSurfaceRouteEnabled(route)) {
    return null;
  }
  const enabledRoute = route!;
  return buildRoute(loadedConfig, {
    route: enabledRoute,
    policy: enabledRoute.policy === "open" ? "open" : "allowlist",
    requireMention: false,
    botId,
  });
}

function resolveGroupRoute(
  loadedConfig: LoadedConfig,
  groupId: string,
  botId?: string,
) {
  const channelConfig = resolveZaloPersonalConfig(loadedConfig.raw.bots.zaloPersonal, botId);
  const exactRoute = channelConfig.groups[groupId];
  if (channelConfig.groupPolicy === "disabled") {
    return { route: null, status: "disabled" as const };
  }
  if (channelConfig.groupPolicy === "allowlist" && !exactRoute) {
    return { route: null, status: "missing" as const };
  }
  const route = mergeSurfaceRouteOverride(channelConfig.groups["*"], exactRoute);
  if (!route) {
    return { route: null, status: "missing" as const };
  }
  if (!isSurfaceRouteEnabled(route)) {
    return { route: null, status: "disabled" as const };
  }
  return {
    route: buildRoute(loadedConfig, {
      route,
      policy: route.policy === "allowlist" ? "allowlist" : "open",
      requireMention: route.requireMention ?? true,
      botId,
    }),
    status: "admitted" as const,
  };
}

export function resolveZaloPersonalConversationRoute(params: {
  loadedConfig: LoadedConfig;
  conversationKind: ZaloPersonalConversationKind;
  chatId: string;
  senderId?: string;
  botId?: string;
}): ZaloPersonalResolvedRoute {
  if (params.conversationKind === "dm") {
    const route = resolveDirectMessageRoute(
      params.loadedConfig,
      params.senderId ?? params.chatId,
      params.botId,
    );
    return {
      conversationKind: "dm" as const,
      route,
      status: route ? "admitted" as const : "disabled" as const,
    };
  }
  const resolved = resolveGroupRoute(params.loadedConfig, params.chatId, params.botId);
  return {
    conversationKind: "group" as const,
    route: resolved.route,
    status: resolved.status === "admitted" ? "admitted" : resolved.status,
  };
}
