import type {
  BotRouteConfig,
  CommandPrefixesConfig,
  FollowUpConfig,
  SurfaceNotificationsConfig,
} from "../core/schema.ts";
import {
  resolveDirectMessageWildcardRoute,
  resolveEffectiveDirectMessageRoute,
} from "./direct-message-route-resolution.ts";
import type {
  ChannelGroupRoute,
  ChannelGroupRoutes,
} from "./channel-config-shapes.ts";

type BotBehaviorOverrides = {
  commandPrefixes?: Partial<CommandPrefixesConfig>;
  surfaceNotifications?: Partial<SurfaceNotificationsConfig>;
  followUp?: Partial<FollowUpConfig>;
};

function cloneCommandPrefixes(value?: Partial<CommandPrefixesConfig>) {
  return {
    slash: [...(value?.slash ?? [])],
    bash: [...(value?.bash ?? [])],
  };
}

function cloneSurfaceNotifications(
  value?: Partial<SurfaceNotificationsConfig>,
) {
  return {
    ...(value?.queueStart ? { queueStart: value.queueStart } : {}),
    ...(value?.loopStart ? { loopStart: value.loopStart } : {}),
  };
}

function cloneFollowUp(value?: Partial<FollowUpConfig>) {
  return {
    ...(value?.mode ? { mode: value.mode } : {}),
    ...(value?.participationTtlSec
      ? { participationTtlSec: value.participationTtlSec }
      : {}),
    ...(value?.participationTtlMin
      ? { participationTtlMin: value.participationTtlMin }
      : {}),
  };
}

export function resolveBotCommandPrefixes(
  providerDefaults: {
    commandPrefixes: CommandPrefixesConfig;
  },
  botConfig: BotBehaviorOverrides,
) {
  return {
    slash:
      botConfig.commandPrefixes?.slash ??
      providerDefaults.commandPrefixes.slash,
    bash:
      botConfig.commandPrefixes?.bash ??
      providerDefaults.commandPrefixes.bash,
  };
}

export function resolveBotSurfaceNotifications(
  providerDefaults: {
    surfaceNotifications?: Partial<SurfaceNotificationsConfig>;
  },
  botConfig: BotBehaviorOverrides,
) {
  return {
    queueStart:
      botConfig.surfaceNotifications?.queueStart ??
      providerDefaults.surfaceNotifications?.queueStart ??
      "brief",
    loopStart:
      botConfig.surfaceNotifications?.loopStart ??
      providerDefaults.surfaceNotifications?.loopStart ??
      "brief",
  };
}

export function resolveBotFollowUp(
  providerDefaults: {
    followUp: FollowUpConfig;
  },
  botConfig: BotBehaviorOverrides,
) {
  return {
    mode: botConfig.followUp?.mode ?? providerDefaults.followUp.mode,
    participationTtlSec:
      botConfig.followUp?.participationTtlSec ??
      providerDefaults.followUp.participationTtlSec,
    participationTtlMin:
      botConfig.followUp?.participationTtlMin ??
      providerDefaults.followUp.participationTtlMin,
  };
}

function cloneBotRoute(route: BotRouteConfig | undefined) {
  if (!route) {
    return undefined;
  }

  return {
    ...route,
    allowUsers: [...(route.allowUsers ?? [])],
    blockUsers: [...(route.blockUsers ?? [])],
    commandPrefixes: route.commandPrefixes
      ? cloneCommandPrefixes(route.commandPrefixes)
      : undefined,
    surfaceNotifications: route.surfaceNotifications
      ? cloneSurfaceNotifications(route.surfaceNotifications)
      : undefined,
    followUp: route.followUp ? cloneFollowUp(route.followUp) : undefined,
  } satisfies BotRouteConfig;
}

export function cloneStandardRoutes(routes: Record<string, BotRouteConfig>) {
  return Object.fromEntries(
    Object.entries(routes).map(([key, route]) => [key, cloneBotRoute(route)!]),
  );
}

function mergeBotRoute(
  base: BotRouteConfig | undefined,
  override: BotRouteConfig | undefined,
) {
  if (!base) {
    return override ? cloneBotRoute(override)! : undefined;
  }
  if (!override) {
    return cloneBotRoute(base)!;
  }
  return {
    ...base,
    ...override,
    allowUsers: [...new Set([...(base.allowUsers ?? []), ...(override.allowUsers ?? [])])],
    blockUsers: [...new Set([...(base.blockUsers ?? []), ...(override.blockUsers ?? [])])],
    commandPrefixes: override.commandPrefixes
      ? cloneCommandPrefixes(override.commandPrefixes)
      : base.commandPrefixes
        ? cloneCommandPrefixes(base.commandPrefixes)
        : undefined,
    surfaceNotifications: override.surfaceNotifications
      ? cloneSurfaceNotifications(override.surfaceNotifications)
      : base.surfaceNotifications
        ? cloneSurfaceNotifications(base.surfaceNotifications)
        : undefined,
    followUp: override.followUp
      ? cloneFollowUp(override.followUp)
      : base.followUp
        ? cloneFollowUp(base.followUp)
        : undefined,
  } satisfies BotRouteConfig;
}

export function mergeStandardRoutes(
  base: Record<string, BotRouteConfig>,
  override: Record<string, BotRouteConfig>,
) {
  const merged: Record<string, BotRouteConfig> = {};
  for (const routeId of new Set([...Object.keys(base), ...Object.keys(override)])) {
    const route = mergeBotRoute(base[routeId], override[routeId]);
    if (route) {
      merged[routeId] = route;
    }
  }
  return merged;
}

function cloneTopicAwareGroupRoute(route: ChannelGroupRoute | undefined) {
  if (!route) {
    return undefined;
  }
  return {
    ...cloneBotRoute(route)!,
    topics: Object.fromEntries(
      Object.entries(route.topics ?? {}).map(([topicId, topicRoute]) => [
        topicId,
        cloneBotRoute(topicRoute)!,
      ]),
    ),
  } satisfies ChannelGroupRoute;
}

function mergeTopicAwareGroupRoute(
  base: ChannelGroupRoute | undefined,
  override: ChannelGroupRoute | undefined,
) {
  if (!base) {
    return cloneTopicAwareGroupRoute(override);
  }
  if (!override) {
    return cloneTopicAwareGroupRoute(base);
  }

  return {
    ...mergeBotRoute(base, override)!,
    topics: Object.fromEntries(
      [...new Set([
        ...Object.keys(base.topics ?? {}),
        ...Object.keys(override.topics ?? {}),
      ])].map((topicId) => [
        topicId,
        mergeBotRoute(base.topics?.[topicId], override.topics?.[topicId])!,
      ]),
    ),
  } satisfies ChannelGroupRoute;
}

export function mergeTopicAwareGroupRoutes(
  base: ChannelGroupRoutes,
  override: ChannelGroupRoutes,
) {
  const merged: ChannelGroupRoutes = {};
  for (const routeId of new Set([...Object.keys(base), ...Object.keys(override)])) {
    const route = mergeTopicAwareGroupRoute(base[routeId], override[routeId]);
    if (route) {
      merged[routeId] = route;
    }
  }
  return merged;
}

export function resolveDirectMessageConfig<TConfig extends {
  directMessages: Record<string, BotRouteConfig>;
}>(
  config: TConfig,
  senderId?: string | number | null,
) {
  return resolveEffectiveDirectMessageRoute(config.directMessages, senderId, {
    exactAdmissionMode: "explicit",
  });
}
