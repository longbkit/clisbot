import type { LoadedConfig } from "../../config/load-config.ts";
import {
  resolveTeamsBotConfig,
  resolveTeamsDirectMessageConfig,
} from "../../config/channel-bots.ts";
import {
  buildSurfaceRoute,
  isSurfaceRouteEnabled,
  mergeSurfaceRouteOverride,
  type ResolvedSurfaceRouteStatus,
  type SurfaceRoute,
  type SurfaceRouteOverride,
} from "../route-policy.ts";
import type { TeamsConversationKind } from "./session-routing.ts";
import type { TeamsConversationType } from "./message.ts";

export type TeamsRoute = SurfaceRoute;

export type TeamsResolvedRoute = {
  conversationKind: TeamsConversationKind;
  route: TeamsRoute | null;
  status: ResolvedSurfaceRouteStatus;
};

type TeamsRouteOverride = SurfaceRouteOverride;

function buildRoute(
  loadedConfig: LoadedConfig,
  params: {
    route?: TeamsRouteOverride | null;
    policy: "open" | "allowlist";
    botId?: string;
  },
): TeamsRoute {
  const teamsConfig = resolveTeamsBotConfig(
    loadedConfig.raw.bots.teams,
    params.botId,
  );
  return buildSurfaceRoute({
    loadedConfig,
    channel: "teams",
    channelConfig: teamsConfig,
    route: params.route,
    policy: params.policy,
    requireMention: true,
  });
}

function resolveSharedRouteStatus(route: TeamsRouteOverride | undefined) {
  if (!route) {
    return "missing" as const;
  }
  return isSurfaceRouteEnabled(route) ? "admitted" as const : "disabled" as const;
}

function resolveSharedAdmissionStatus(params: {
  policy?: "disabled" | "allowlist" | "open";
  exactRoute?: TeamsRouteOverride;
}) {
  if (params.policy === "disabled") {
    return "disabled" as const;
  }
  if (params.policy === "allowlist" && !params.exactRoute) {
    return "missing" as const;
  }
  return undefined;
}

function resolveChannelRoute(
  loadedConfig: LoadedConfig,
  conversationId: string,
  botId?: string,
) {
  const teamsConfig = resolveTeamsBotConfig(loadedConfig.raw.bots.teams, botId);
  const exactRoute = teamsConfig.channels[conversationId];
  const admissionStatus = resolveSharedAdmissionStatus({
    policy: teamsConfig.channelPolicy,
    exactRoute,
  });
  if (admissionStatus) {
    return { route: null, status: admissionStatus };
  }

  const wildcardRoute = teamsConfig.channels["*"];
  const route = mergeSurfaceRouteOverride(wildcardRoute, exactRoute);
  const status = resolveSharedRouteStatus(route);
  if (status !== "admitted") {
    return { route: null, status };
  }

  return {
    route: buildRoute(loadedConfig, {
      route,
      policy: route?.policy === "allowlist" ? "allowlist" : "open",
      botId,
    }),
    status,
  };
}

function resolveGroupRoute(
  loadedConfig: LoadedConfig,
  conversationId: string,
  botId?: string,
) {
  const teamsConfig = resolveTeamsBotConfig(loadedConfig.raw.bots.teams, botId);
  const exactRoute = teamsConfig.groupChats[conversationId];
  const admissionStatus = resolveSharedAdmissionStatus({
    policy: teamsConfig.groupPolicy,
    exactRoute,
  });
  if (admissionStatus) {
    return { route: null, status: admissionStatus };
  }

  const wildcardRoute = teamsConfig.groupChats["*"];
  const route = mergeSurfaceRouteOverride(wildcardRoute, exactRoute);
  const status = resolveSharedRouteStatus(route);
  if (status !== "admitted") {
    return { route: null, status };
  }

  return {
    route: buildRoute(loadedConfig, {
      route,
      policy: route?.policy === "allowlist" ? "allowlist" : "open",
      botId,
    }),
    status,
  };
}

function resolveDirectMessageRoute(
  loadedConfig: LoadedConfig,
  userId?: string,
  botId?: string,
) {
  const teamsConfig = resolveTeamsBotConfig(loadedConfig.raw.bots.teams, botId);
  const route = resolveTeamsDirectMessageConfig(teamsConfig, userId);
  if (!isSurfaceRouteEnabled(route)) {
    return null;
  }
  return buildRoute(loadedConfig, {
    route,
    policy: route?.policy === "open" ? "open" : "allowlist",
    botId,
  });
}

export function resolveTeamsConversationRoute(params: {
  loadedConfig: LoadedConfig;
  conversationType: TeamsConversationType;
  conversationId: string;
  userId?: string;
  botId?: string;
}): TeamsResolvedRoute {
  if (params.conversationType === "personal") {
    const route = resolveDirectMessageRoute(
      params.loadedConfig,
      params.userId,
      params.botId,
    );
    return {
      conversationKind: "dm" as const,
      route,
      status: route ? "admitted" as const : "disabled" as const,
    };
  }

  if (params.conversationType === "channel") {
    const shared = resolveChannelRoute(
      params.loadedConfig,
      params.conversationId,
      params.botId,
    );
    return {
      conversationKind: "channel" as const,
      route: shared.route,
      status: shared.status,
    };
  }

  // groupChat
  const shared = resolveGroupRoute(
    params.loadedConfig,
    params.conversationId,
    params.botId,
  );
  return {
    conversationKind: "group" as const,
    route: shared.route,
    status: shared.status,
  };
}
