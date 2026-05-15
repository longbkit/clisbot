import { type LoadedConfig } from "../../config/core/load-config.ts";
import {
  resolveZaloBotConfig,
  resolveZaloBotDirectMessageConfig,
} from "./config.ts";
import {
  buildSurfaceRoute,
  isSurfaceRouteEnabled,
  type SurfaceRoute,
  type SurfaceRouteOverride,
} from "../config/route-policy.ts";

export type ZaloBotRoute = SurfaceRoute;

export type ZaloBotResolvedRoute =
  | {
      conversationKind: "dm";
      route: ZaloBotRoute | null;
      status: "admitted" | "disabled";
    }
  | {
      conversationKind: "group";
      route: null;
      status: "unsupported";
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

  return {
    conversationKind: "group" as const,
    route: null,
    status: "unsupported" as const,
  };
}
