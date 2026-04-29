import { type LoadedConfig } from "../../config/load-config.ts";
import {
  resolveTelegramBotConfig,
  resolveTelegramDirectMessageConfig,
} from "../../config/channel-bots.ts";
import type { TelegramBotConfig } from "../../config/schema.ts";
import {
  buildSurfaceRoute,
  isSurfaceRouteEnabled,
  mergeSurfaceRouteOverride,
  type ResolvedSurfaceRouteStatus,
  type SurfaceRoute,
  type SurfaceRouteOverride,
} from "../route-policy.ts";
import { type TelegramConversationKind } from "./session-routing.ts";

export type TelegramRoute = SurfaceRoute;

export type TelegramResolvedRoute = {
  conversationKind: TelegramConversationKind;
  route: TelegramRoute | null;
  status: ResolvedSurfaceRouteStatus;
};

type TelegramRouteOverride = SurfaceRouteOverride;

function buildRoute(
  loadedConfig: LoadedConfig,
  params: {
    route?: TelegramRouteOverride | null;
    policy: "open" | "allowlist";
    botId?: string;
    accountId?: string;
  },
): TelegramRoute {
  const telegramConfig = resolveTelegramBotConfig(
    loadedConfig.raw.bots.telegram,
    params.botId ?? params.accountId,
  );
  return buildSurfaceRoute({
    loadedConfig,
    channel: "telegram",
    channelConfig: telegramConfig,
    route: params.route,
    policy: params.policy,
    requireMention: true,
  });
}

function mergeTelegramGroupRoute(
  base: TelegramBotConfig["groups"][string] | undefined,
  override: TelegramBotConfig["groups"][string] | undefined,
) {
  const merged = mergeSurfaceRouteOverride(base, override);
  if (!merged) {
    return undefined;
  }

  return {
    ...merged,
    topics: Object.fromEntries(
      [...new Set([
        ...Object.keys(base?.topics ?? {}),
        ...Object.keys(override?.topics ?? {}),
      ])].map((topicId) => [
        topicId,
        mergeSurfaceRouteOverride(
          base?.topics?.[topicId],
          override?.topics?.[topicId],
        )!,
      ]),
    ),
  } satisfies TelegramBotConfig["groups"][string];
}

function resolveSharedRouteStatus(route: TelegramRouteOverride | undefined) {
  if (!route) {
    return "missing" as const;
  }
  return isSurfaceRouteEnabled(route) ? "admitted" as const : "disabled" as const;
}

function resolveSharedAdmissionStatus(params: {
  policy?: "disabled" | "allowlist" | "open";
  exactRoute?: TelegramBotConfig["groups"][string];
}) {
  if (params.policy === "disabled") {
    return "disabled" as const;
  }
  if (params.policy === "allowlist" && !params.exactRoute) {
    return "missing" as const;
  }
  return undefined;
}

function resolveGroupRoute(
  loadedConfig: LoadedConfig,
  chatId: number,
  topicId?: number,
  botId?: string,
  accountId?: string,
) {
  const resolvedBotId = botId ?? accountId;
  const telegramConfig = resolveTelegramBotConfig(loadedConfig.raw.bots.telegram, resolvedBotId);
  const exactRoute = telegramConfig.groups[String(chatId)];
  const admissionStatus = resolveSharedAdmissionStatus({
    policy: telegramConfig.groupPolicy,
    exactRoute,
  });
  if (admissionStatus) {
    return {
      route: null,
      status: admissionStatus,
    };
  }
  const groupRoute = mergeTelegramGroupRoute(
    telegramConfig.groups["*"],
    exactRoute,
  );
  const topicRoute = topicId != null
    ? mergeSurfaceRouteOverride(
        groupRoute?.topics?.[String(topicId)],
        telegramConfig.groups[String(chatId)]?.topics?.[String(topicId)],
      )
    : undefined;
  const route = mergeSurfaceRouteOverride(groupRoute, topicRoute);
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
  senderId?: number,
  botId?: string,
  accountId?: string,
) {
  const resolvedBotId = botId ?? accountId;
  const telegramConfig = resolveTelegramBotConfig(loadedConfig.raw.bots.telegram, resolvedBotId);
  const route = resolveTelegramDirectMessageConfig(telegramConfig, senderId);
  if (!isSurfaceRouteEnabled(route)) {
    return null;
  }

  return buildRoute(loadedConfig, {
    route,
    policy: route?.policy === "open" ? "open" : "allowlist",
    botId: resolvedBotId,
  });
}

export function resolveTelegramConversationRoute(params: {
  loadedConfig: LoadedConfig;
  chatType: "private" | "group" | "supergroup" | "channel";
  chatId: number;
  topicId?: number;
  isForum?: boolean;
  botId?: string;
  accountId?: string;
}) {
  if (params.chatType === "private") {
    const route = resolveDirectMessageRoute(
      params.loadedConfig,
      params.chatId,
      params.botId,
      params.accountId,
    );
    return {
      conversationKind: "dm" as const,
      route,
      status: route ? "admitted" as const : "disabled" as const,
    };
  }

  if (params.chatType !== "group" && params.chatType !== "supergroup") {
    return {
      conversationKind: "group" as const,
      route: null,
      status: "missing" as const,
    };
  }

  const conversationKind =
    params.isForum || params.topicId != null ? ("topic" as const) : ("group" as const);
  const shared = resolveGroupRoute(
    params.loadedConfig,
    params.chatId,
    params.topicId,
    params.botId,
    params.accountId,
  );
  return {
    conversationKind,
    route: shared.route,
    status: shared.status,
  };
}
