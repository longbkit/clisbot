import { type LoadedConfig } from "../../config/load-config.ts";
import {
  resolveSlackBotConfig,
  resolveSlackDirectMessageConfig,
} from "../../config/channel-bots.ts";
import {
  buildSurfaceRoute,
  isSurfaceRouteEnabled,
  mergeSurfaceRouteOverride,
  type ResolvedSurfaceRouteStatus,
  type SurfaceRoute,
  type SurfaceRouteOverride,
} from "../route-policy.ts";
import { type SlackConversationKind } from "./session-routing.ts";

export type SlackRoute = SurfaceRoute & {
  replyToMode: "thread" | "all";
};

export type SlackResolvedRoute = {
  conversationKind: SlackConversationKind;
  route: SlackRoute | null;
  status: ResolvedSurfaceRouteStatus;
};

type SlackRouteOverride = SurfaceRouteOverride;

function buildRoute(loadedConfig: LoadedConfig, params: {
  route?: SlackRouteOverride | null;
  policy: "open" | "allowlist";
  botId?: string;
  accountId?: string;
}): SlackRoute {
  const slackConfig = resolveSlackBotConfig(
    loadedConfig.raw.bots.slack,
    params.botId ?? params.accountId,
  );
  return {
    ...buildSurfaceRoute({
      loadedConfig,
      channel: "slack",
      channelConfig: slackConfig,
      route: params.route,
      policy: params.policy,
      requireMention: true,
    }),
    replyToMode: slackConfig.replyToMode,
  };
}

function resolveSharedRouteStatus(route: SlackRouteOverride | undefined) {
  if (!route) {
    return "missing" as const;
  }
  return isSurfaceRouteEnabled(route) ? "admitted" as const : "disabled" as const;
}

function resolveSharedAdmissionStatus(params: {
  policy?: "disabled" | "allowlist" | "open";
  exactRoute?: SlackRouteOverride;
}) {
  if (params.policy === "disabled") {
    return "disabled" as const;
  }
  if (params.policy === "allowlist" && !params.exactRoute) {
    return "missing" as const;
  }
  return undefined;
}

function resolveSharedRoute(
  loadedConfig: LoadedConfig,
  channelId: string,
  conversationKind: SlackConversationKind,
  botId?: string,
  accountId?: string,
) {
  const resolvedBotId = botId ?? accountId;
  const slackConfig = resolveSlackBotConfig(loadedConfig.raw.bots.slack, resolvedBotId);
  const exactRoute = slackConfig.groups[channelId];
  const admissionStatus = resolveSharedAdmissionStatus({
    policy: conversationKind === "channel" ? slackConfig.channelPolicy : slackConfig.groupPolicy,
    exactRoute,
  });
  if (admissionStatus) {
    return {
      route: null,
      status: admissionStatus,
    };
  }
  const route = mergeSurfaceRouteOverride(
    slackConfig.groups["*"],
    exactRoute,
  );
  const status = resolveSharedRouteStatus(route);
  if (status !== "admitted") {
    return {
      route: null,
      status,
    };
  }
  return {
    route: buildRoute(loadedConfig, {
      route,
      policy: route?.policy === "allowlist" ? "allowlist" : "open",
      botId: resolvedBotId,
    }),
    status,
  };
}

function resolveDirectMessageRoute(
  loadedConfig: LoadedConfig,
  userId?: string,
  botId?: string,
  accountId?: string,
): SlackRoute | null {
  const resolvedBotId = botId ?? accountId;
  const slackConfig = resolveSlackBotConfig(loadedConfig.raw.bots.slack, resolvedBotId);
  const route = resolveSlackDirectMessageConfig(slackConfig, userId);
  if (!isSurfaceRouteEnabled(route)) {
    return null;
  }

  return buildRoute(loadedConfig, {
    route,
    policy: route?.policy === "open" ? "open" : "allowlist",
    botId: resolvedBotId,
  });
}

export function resolveSlackConversationRoute(
  loadedConfig: LoadedConfig,
  event: any,
  options: {
    botId?: string;
    accountId?: string;
  } = {},
): SlackResolvedRoute {
  const channelType = (event.channel_type as string | undefined)?.trim().toLowerCase();
  const channelId = event.channel as string | undefined;

  if (channelType === "im") {
    const route = resolveDirectMessageRoute(
      loadedConfig,
      typeof event.user === "string" ? event.user.trim().toUpperCase() : undefined,
      options.botId,
      options.accountId,
    );
    return {
      conversationKind: "dm",
      route,
      status: route ? "admitted" : "disabled",
    };
  }

  const shared = channelId
    ? resolveSharedRoute(
        loadedConfig,
        channelId,
        channelType === "mpim" ? "group" : "channel",
        options.botId,
        options.accountId,
      )
    : { route: null, status: "missing" as const };
  return {
    conversationKind: channelType === "mpim" ? "group" : "channel",
    route: shared.route,
    status: shared.status,
  };
}
