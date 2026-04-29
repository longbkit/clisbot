import type {
  BotRouteConfig,
  ClisbotConfig,
  CommandPrefixesConfig,
  FollowUpConfig,
  SlackBotConfig,
  SlackProviderDefaultsConfig,
  SurfaceNotificationsConfig,
  TelegramBotConfig,
  TelegramProviderDefaultsConfig,
} from "./schema.ts";
import {
  resolveDirectMessageWildcardRoute,
  resolveEffectiveDirectMessageRoute,
} from "./direct-message-routes.ts";

// Canonical bot-oriented config helpers live here.

export type SlackBotCredentialConfig = {
  appToken: string;
  botToken: string;
};

export type TelegramBotCredentialConfig = {
  botToken: string;
};

export type SlackAccountConfig = SlackBotCredentialConfig;
export type TelegramAccountConfig = TelegramBotCredentialConfig;

export type ResolvedSlackBotConfig = Omit<SlackBotConfig, "directMessages" | "groups"> &
  SlackProviderDefaultsConfig & {
    id: string;
    directMessages: Record<string, BotRouteConfig>;
    groups: Record<string, BotRouteConfig>;
    appToken: string;
    botToken: string;
  };

export type ResolvedTelegramBotConfig = Omit<TelegramBotConfig, "directMessages" | "groups"> &
  TelegramProviderDefaultsConfig & {
    id: string;
    directMessages: Record<string, BotRouteConfig>;
    groups: Record<string, TelegramBotConfig["groups"][string]>;
    botToken: string;
  };

function normalizeBotId(botId?: string | null) {
  const normalized = botId?.trim();
  return normalized ? normalized : undefined;
}

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

function cloneSlackRoutes(routes: Record<string, BotRouteConfig>) {
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

function mergeSlackRoutes(
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

function cloneTelegramRoutes(routes: TelegramBotConfig["groups"]) {
  return Object.fromEntries(
    Object.entries(routes).map(([key, route]) => [
      key,
      {
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
        topics: Object.fromEntries(
          Object.entries(route.topics ?? {}).map(([topicId, topicRoute]) => [
            topicId,
            cloneBotRoute(topicRoute)!,
          ]),
        ),
      },
    ]),
  );
}

function cloneTelegramGroupRoute(route: TelegramBotConfig["groups"][string] | undefined) {
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
  } satisfies TelegramBotConfig["groups"][string];
}

function mergeTelegramGroupRoute(
  base: TelegramBotConfig["groups"][string] | undefined,
  override: TelegramBotConfig["groups"][string] | undefined,
) {
  if (!base) {
    return cloneTelegramGroupRoute(override);
  }
  if (!override) {
    return cloneTelegramGroupRoute(base);
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
  } satisfies TelegramBotConfig["groups"][string];
}

function mergeTelegramRoutes(
  base: TelegramBotConfig["groups"],
  override: TelegramBotConfig["groups"],
) {
  const merged: TelegramBotConfig["groups"] = {};
  for (const routeId of new Set([...Object.keys(base), ...Object.keys(override)])) {
    const route = mergeTelegramGroupRoute(base[routeId], override[routeId]);
    if (route) {
      merged[routeId] = route;
    }
  }
  return merged;
}

function getSlackBotsRecord(
  config: ClisbotConfig["bots"]["slack"],
) {
  const { defaults, ...bots } = config;
  return bots;
}

function getTelegramBotsRecord(
  config: ClisbotConfig["bots"]["telegram"],
) {
  const { defaults, ...bots } = config;
  return bots;
}

function getConfiguredDefaultBotId(params: {
  defaultBotId?: string;
  bots: Record<string, unknown>;
}) {
  const explicit = normalizeBotId(params.defaultBotId);
  if (explicit) {
    return explicit;
  }

  if ("default" in params.bots) {
    return "default";
  }

  const firstBotId = Object.keys(params.bots)[0];
  return normalizeBotId(firstBotId) ?? "default";
}

export function resolveSlackBotId(
  config: ClisbotConfig["bots"]["slack"],
  botId?: string | null,
) {
  return normalizeBotId(botId) ?? getConfiguredDefaultBotId({
    defaultBotId: config.defaults.defaultBotId,
    bots: getSlackBotsRecord(config),
  });
}

export function resolveTelegramBotId(
  config: ClisbotConfig["bots"]["telegram"],
  botId?: string | null,
) {
  return normalizeBotId(botId) ?? getConfiguredDefaultBotId({
    defaultBotId: config.defaults.defaultBotId,
    bots: getTelegramBotsRecord(config),
  });
}

export function resolveSlackAccountId(
  config: ClisbotConfig["bots"]["slack"],
  accountId?: string | null,
) {
  return resolveSlackBotId(config, accountId);
}

export function resolveTelegramAccountId(
  config: ClisbotConfig["bots"]["telegram"],
  accountId?: string | null,
) {
  return resolveTelegramBotId(config, accountId);
}

export function getSlackBotRecord(
  config: ClisbotConfig["bots"]["slack"],
  botId: string,
) {
  return getSlackBotsRecord(config)[botId] as SlackBotConfig | undefined;
}

export function getTelegramBotRecord(
  config: ClisbotConfig["bots"]["telegram"],
  botId: string,
) {
  return getTelegramBotsRecord(config)[botId] as TelegramBotConfig | undefined;
}

export function getSlackBotConfig(
  config: ClisbotConfig["bots"]["slack"],
  accountId: string,
) {
  return getSlackBotRecord(config, accountId);
}

export function getTelegramBotConfig(
  config: ClisbotConfig["bots"]["telegram"],
  accountId: string,
) {
  return getTelegramBotRecord(config, accountId);
}

export function resolveSlackBotConfig(
  config: ClisbotConfig["bots"]["slack"],
  botId?: string | null,
): ResolvedSlackBotConfig {
  const resolvedBotId = resolveSlackBotId(config, botId);
  const providerDefaults = config.defaults;
  const botConfig = getSlackBotRecord(config, resolvedBotId);
  if (!botConfig) {
    throw new Error(`Unknown Slack bot: ${resolvedBotId}`);
  }

  return {
    ...providerDefaults,
    ...botConfig,
    id: resolvedBotId,
    commandPrefixes: {
      slash:
        botConfig.commandPrefixes?.slash ??
        providerDefaults.commandPrefixes.slash,
      bash:
        botConfig.commandPrefixes?.bash ??
        providerDefaults.commandPrefixes.bash,
    },
    surfaceNotifications: {
      queueStart:
        botConfig.surfaceNotifications?.queueStart ??
        providerDefaults.surfaceNotifications?.queueStart ??
        "brief",
      loopStart:
        botConfig.surfaceNotifications?.loopStart ??
        providerDefaults.surfaceNotifications?.loopStart ??
        "brief",
    },
    followUp: {
      mode: botConfig.followUp?.mode ?? providerDefaults.followUp.mode,
      participationTtlSec:
        botConfig.followUp?.participationTtlSec ??
        providerDefaults.followUp.participationTtlSec,
      participationTtlMin:
        botConfig.followUp?.participationTtlMin ??
        providerDefaults.followUp.participationTtlMin,
    },
    directMessages: {
      ...cloneSlackRoutes(providerDefaults.directMessages),
      ...cloneSlackRoutes(botConfig.directMessages ?? {}),
    },
    groups: mergeSlackRoutes(
      providerDefaults.groups,
      botConfig.groups ?? {},
    ),
    appToken: botConfig.appToken?.trim() ?? "",
    botToken: botConfig.botToken?.trim() ?? "",
  };
}

export function resolveTelegramBotConfig(
  config: ClisbotConfig["bots"]["telegram"],
  botId?: string | null,
): ResolvedTelegramBotConfig {
  const resolvedBotId = resolveTelegramBotId(config, botId);
  const providerDefaults = config.defaults;
  const botConfig = getTelegramBotRecord(config, resolvedBotId);
  if (!botConfig) {
    throw new Error(`Unknown Telegram bot: ${resolvedBotId}`);
  }

  return {
    ...providerDefaults,
    ...botConfig,
    id: resolvedBotId,
    commandPrefixes: {
      slash:
        botConfig.commandPrefixes?.slash ??
        providerDefaults.commandPrefixes.slash,
      bash:
        botConfig.commandPrefixes?.bash ??
        providerDefaults.commandPrefixes.bash,
    },
    surfaceNotifications: {
      queueStart:
        botConfig.surfaceNotifications?.queueStart ??
        providerDefaults.surfaceNotifications?.queueStart ??
        "brief",
      loopStart:
        botConfig.surfaceNotifications?.loopStart ??
        providerDefaults.surfaceNotifications?.loopStart ??
        "brief",
    },
    followUp: {
      mode: botConfig.followUp?.mode ?? providerDefaults.followUp.mode,
      participationTtlSec:
        botConfig.followUp?.participationTtlSec ??
        providerDefaults.followUp.participationTtlSec,
      participationTtlMin:
        botConfig.followUp?.participationTtlMin ??
        providerDefaults.followUp.participationTtlMin,
    },
    directMessages: {
      ...cloneSlackRoutes(providerDefaults.directMessages),
      ...cloneSlackRoutes(botConfig.directMessages ?? {}),
    },
    groups: mergeTelegramRoutes(
      providerDefaults.groups,
      botConfig.groups ?? {},
    ),
    botToken: botConfig.botToken?.trim() ?? "",
  };
}

export function resolveSlackDirectMessageConfig(
  config: ResolvedSlackBotConfig,
  userId?: string | null,
) {
  return resolveEffectiveDirectMessageRoute(config.directMessages, userId, {
    exactAdmissionMode: "explicit",
  });
}

export function resolveTelegramDirectMessageConfig(
  config: ResolvedTelegramBotConfig,
  senderId?: string | number | null,
) {
  return resolveEffectiveDirectMessageRoute(config.directMessages, senderId, {
    exactAdmissionMode: "explicit",
  });
}

export function resolveSlackDirectMessageAdmissionConfig(
  config: ResolvedSlackBotConfig,
) {
  return resolveDirectMessageWildcardRoute(config.directMessages);
}

export function resolveTelegramDirectMessageAdmissionConfig(
  config: ResolvedTelegramBotConfig,
) {
  return resolveDirectMessageWildcardRoute(config.directMessages);
}

export function resolveSlackBotCredentials(
  config: ClisbotConfig["bots"]["slack"],
  botId?: string | null,
): { botId: string; config: SlackBotCredentialConfig } {
  const resolved = resolveSlackBotConfig(config, botId);
  if (resolved.appToken && resolved.botToken) {
    return {
      botId: resolved.id,
      config: {
        appToken: resolved.appToken,
        botToken: resolved.botToken,
      },
    };
  }

  throw new Error(`Unknown Slack bot: ${resolved.id}`);
}

export function resolveTelegramBotCredentials(
  config: ClisbotConfig["bots"]["telegram"],
  botId?: string | null,
): { botId: string; config: TelegramBotCredentialConfig } {
  const resolved = resolveTelegramBotConfig(config, botId);
  if (resolved.botToken) {
    return {
      botId: resolved.id,
      config: {
        botToken: resolved.botToken,
      },
    };
  }

  throw new Error(`Unknown Telegram bot: ${resolved.id}`);
}

export function resolveSlackAccountConfig(
  config: ClisbotConfig["bots"]["slack"],
  accountId?: string | null,
): { accountId: string; config: SlackBotCredentialConfig } {
  const resolved = resolveSlackBotCredentials(config, accountId);
  return {
    accountId: resolved.botId,
    config: resolved.config,
  };
}

export function resolveTelegramAccountConfig(
  config: ClisbotConfig["bots"]["telegram"],
  accountId?: string | null,
): { accountId: string; config: TelegramBotCredentialConfig } {
  const resolved = resolveTelegramBotCredentials(config, accountId);
  return {
    accountId: resolved.botId,
    config: resolved.config,
  };
}

export function listSlackBots(
  config: ClisbotConfig["bots"]["slack"],
): Array<{ botId: string; config: SlackBotCredentialConfig }> {
  return Object.entries(getSlackBotsRecord(config))
    .filter(([, bot]) => bot.enabled !== false)
    .map(([botId]) => {
      const resolved = resolveSlackBotConfig(config, botId);
      return {
        botId,
        config: {
          appToken: resolved.appToken,
          botToken: resolved.botToken,
        },
      };
    })
    .filter(({ config }) => config.appToken.trim() && config.botToken.trim());
}

export function listTelegramBots(
  config: ClisbotConfig["bots"]["telegram"],
): Array<{ botId: string; config: TelegramBotCredentialConfig }> {
  return Object.entries(getTelegramBotsRecord(config))
    .filter(([, bot]) => bot.enabled !== false)
    .map(([botId]) => {
      const resolved = resolveTelegramBotConfig(config, botId);
      return {
        botId,
        config: {
          botToken: resolved.botToken,
        },
      };
    })
    .filter(({ config }) => config.botToken.trim());
}

export function listSlackAccounts(
  config: ClisbotConfig["bots"]["slack"],
): Array<{ accountId: string; config: SlackBotCredentialConfig }> {
  return listSlackBots(config).map((entry) => ({
    accountId: entry.botId,
    config: entry.config,
  }));
}

export function listTelegramAccounts(
  config: ClisbotConfig["bots"]["telegram"],
): Array<{ accountId: string; config: TelegramBotCredentialConfig }> {
  return listTelegramBots(config).map((entry) => ({
    accountId: entry.botId,
    config: entry.config,
  }));
}
