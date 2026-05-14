import { type LoadedConfig } from "../../config/core/load-config.ts";
import {
  resolveZaloBotConfig,
  resolveZaloBotDirectMessageConfig,
} from "./config.ts";
import {
  buildSurfaceRoute,
  isSurfaceRouteEnabled,
  mergeSurfaceRouteOverride,
  type ResolvedSurfaceRouteStatus,
  type SurfaceRoute,
  type SurfaceRouteOverride,
} from "../config/route-policy.ts";
import { type ZaloBotConversationKind } from "./session-routing.ts";

export type ZaloBotRoute = SurfaceRoute;

export type ZaloBotResolvedRoute = {
  conversationKind: ZaloBotConversationKind;
  route: ZaloBotRoute | null;
  status: ResolvedSurfaceRouteStatus;
};

function buildRoute(
  loadedConfig: LoadedConfig,
  params: {
    route?: SurfaceRouteOverride | null;
    policy: "open" | "allowlist";
    botId?: string;
  },
) {
  const zaloConfig = resolveZaloBotConfig(
    loadedConfig.raw.bots.zaloBot,
    params.botId,
  );
  return buildSurfaceRoute({
    loadedConfig,
    channel: "zalo-bot",
    channelConfig: zaloConfig,
    route: params.route,
    policy: params.policy,
    requireMention: true,
  });
}

function resolveGroupRoute(
  loadedConfig: LoadedConfig,
  chatId: string,
  botId?: string,
) {
  const zaloConfig = resolveZaloBotConfig(loadedConfig.raw.bots.zaloBot, botId);
  const exactRoute = zaloConfig.groups[chatId];
  if (zaloConfig.groupPolicy === "disabled") {
    return { route: null, status: "disabled" as const };
  }
  if (zaloConfig.groupPolicy === "allowlist" && !exactRoute) {
    return { route: null, status: "missing" as const };
  }

  const route = mergeSurfaceRouteOverride(
    zaloConfig.groups["*"],
    exactRoute,
  );
  if (!isSurfaceRouteEnabled(route)) {
    return {
      route: null,
      status: route ? "disabled" as const : "missing" as const,
    };
  }
  const enabledRoute = route!;

  return {
    route: buildRoute(loadedConfig, {
      route: enabledRoute,
      policy: enabledRoute.policy === "allowlist" ? "allowlist" : "open",
      botId,
    }),
    status: "admitted" as const,
  };
}

function resolveDirectMessageRoute(
  loadedConfig: LoadedConfig,
  senderId?: string,
  botId?: string,
) {
  const zaloConfig = resolveZaloBotConfig(loadedConfig.raw.bots.zaloBot, botId);
  const route = resolveZaloBotDirectMessageConfig(zaloConfig, senderId);
  if (!isSurfaceRouteEnabled(route)) {
    return null;
  }
  const enabledRoute = route!;

  return buildRoute(loadedConfig, {
    route: enabledRoute,
    policy: enabledRoute.policy === "open" ? "open" : "allowlist",
    botId,
  });
}

export function resolveZaloBotConversationRoute(params: {
  loadedConfig: LoadedConfig;
  chatType: "PRIVATE" | "GROUP";
  chatId: string;
  senderId?: string;
  botId?: string;
}) {
  if (params.chatType === "PRIVATE") {
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

  const shared = resolveGroupRoute(
    params.loadedConfig,
    params.chatId,
    params.botId,
  );
  return {
    conversationKind: "group" as const,
    route: shared.route,
    status: shared.status,
  };
}
