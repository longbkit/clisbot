import type {
  BotRouteConfig,
  ClisbotConfig,
  SlackBotConfig,
  TelegramBotConfig,
} from "./schema.ts";

type DirectMessageRouteOwner = {
  directMessages: Record<string, BotRouteConfig>;
};

type Provider = "slack" | "telegram";

export const DIRECT_MESSAGE_WILDCARD_ROUTE_ID = "*";
export const LEGACY_DIRECT_MESSAGE_WILDCARD_ROUTE_IDS = ["dm:*", "dm:*".toUpperCase()];
const DIRECT_MESSAGE_ADMISSION_FIELDS = [
  "enabled",
  "policy",
  "allowUsers",
  "blockUsers",
  "allowBots",
] as const;

export function isDirectMessageWildcardRouteId(routeId: string) {
  const normalized = routeId.trim();
  return (
    normalized === DIRECT_MESSAGE_WILDCARD_ROUTE_ID ||
    LEGACY_DIRECT_MESSAGE_WILDCARD_ROUTE_IDS.includes(normalized)
  );
}

export function normalizeDirectMessageRouteId(routeId: string) {
  const normalized = routeId.trim();
  if (!normalized) {
    return "";
  }
  if (isDirectMessageWildcardRouteId(normalized)) {
    return DIRECT_MESSAGE_WILDCARD_ROUTE_ID;
  }
  if (normalized.startsWith("dm:")) {
    return normalized.slice(3).trim();
  }
  return normalized;
}

export function isExactDirectMessageRouteId(routeId: string) {
  const normalized = normalizeDirectMessageRouteId(routeId);
  return Boolean(normalized && normalized !== DIRECT_MESSAGE_WILDCARD_ROUTE_ID);
}

function mergeAudienceEntries(...sources: Array<string[] | undefined>) {
  return [...new Set(
    sources.flatMap((source) => (source ?? []).map((entry) => entry.trim()).filter(Boolean)),
  )];
}

function mergeRoute(
  base: Partial<BotRouteConfig> | undefined,
  override: Partial<BotRouteConfig> | undefined,
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
    allowUsers: mergeAudienceEntries(base.allowUsers, override.allowUsers),
    blockUsers: mergeAudienceEntries(base.blockUsers, override.blockUsers),
  } satisfies Partial<BotRouteConfig>;
}

function stripDirectMessageAdmissionFields(route: Partial<BotRouteConfig> | undefined) {
  if (!route) {
    return undefined;
  }

  const nextRoute = { ...route };
  for (const field of DIRECT_MESSAGE_ADMISSION_FIELDS) {
    delete nextRoute[field];
  }
  return nextRoute;
}

export function resolveDirectMessageWildcardRoute(
  routes: Record<string, Partial<BotRouteConfig>>,
) {
  return routes[DIRECT_MESSAGE_WILDCARD_ROUTE_ID] ??
    LEGACY_DIRECT_MESSAGE_WILDCARD_ROUTE_IDS
      .map((routeId) => routes[routeId])
      .find(Boolean);
}

export function resolveDirectMessageExactRoute(
  routes: Record<string, Partial<BotRouteConfig>>,
  subjectId?: string | number | null,
) {
  const normalizedSubjectId =
    typeof subjectId === "number" ? String(subjectId) : subjectId?.trim();

  if (!normalizedSubjectId) {
    return undefined;
  }

  return routes[normalizedSubjectId] ?? routes[`dm:${normalizedSubjectId}`];
}

export function resolveEffectiveDirectMessageRoute(
  routes: Record<string, Partial<BotRouteConfig>>,
  subjectId?: string | number | null,
  options: {
    exactAdmissionMode?: "inherit" | "explicit";
  } = {},
) {
  const wildcardRoute = resolveDirectMessageWildcardRoute(routes);
  const exactRoute = resolveDirectMessageExactRoute(routes, subjectId);
  const effectiveExactRoute = options.exactAdmissionMode === "explicit"
    ? exactRoute
    : stripDirectMessageAdmissionFields(exactRoute);
  return mergeRoute(wildcardRoute, effectiveExactRoute);
}

function orderWildcardFirst<TRoute>(
  routes: Record<string, TRoute>,
) {
  const wildcard = routes[DIRECT_MESSAGE_WILDCARD_ROUTE_ID];
  if (!wildcard) {
    return routes;
  }
  return {
    [DIRECT_MESSAGE_WILDCARD_ROUTE_ID]: wildcard,
    ...Object.fromEntries(
      Object.entries(routes).filter(([routeId]) => routeId !== DIRECT_MESSAGE_WILDCARD_ROUTE_ID),
    ),
  };
}

function normalizeDirectMessageRouteMap(params: {
  owner: DirectMessageRouteOwner;
  exactAdmissionMode: "inherit" | "explicit";
}) {
  const nextRoutes: Record<string, BotRouteConfig> = {};

  for (const [routeId, route] of Object.entries(params.owner.directMessages ?? {})) {
    const normalizedRouteId = normalizeDirectMessageRouteId(routeId);
    if (!normalizedRouteId) {
      continue;
    }

    const normalizedRoute =
      params.exactAdmissionMode === "inherit" && normalizedRouteId !== DIRECT_MESSAGE_WILDCARD_ROUTE_ID
        ? stripDirectMessageAdmissionFields(route) ?? {}
        : route;

    nextRoutes[normalizedRouteId] = {
      ...createDirectMessageRouteShell(),
      ...mergeRoute(nextRoutes[normalizedRouteId], normalizedRoute as BotRouteConfig),
    };
  }

  params.owner.directMessages = orderWildcardFirst(nextRoutes);
}

function normalizeProviderDirectMessageRoutes<TConfig extends {
  defaults: DirectMessageRouteOwner;
}>(params: {
  providerConfig: TConfig;
  exactAdmissionMode: "inherit" | "explicit";
}) {
  normalizeDirectMessageRouteMap({
    owner: params.providerConfig.defaults,
    exactAdmissionMode: "explicit",
  });

  for (const [botId, botConfig] of Object.entries(params.providerConfig)) {
    if (botId === "defaults") {
      continue;
    }
    normalizeDirectMessageRouteMap({
      owner: botConfig as DirectMessageRouteOwner,
      exactAdmissionMode: params.exactAdmissionMode,
    });
  }
}

export function normalizeConfigDirectMessageRoutes(
  config: ClisbotConfig,
  options: {
    exactAdmissionMode?: "inherit" | "explicit";
  } = {},
) {
  const exactAdmissionMode = options.exactAdmissionMode ?? "explicit";
  normalizeProviderDirectMessageRoutes({
    providerConfig: config.bots.slack,
    exactAdmissionMode,
  });
  normalizeProviderDirectMessageRoutes({
    providerConfig: config.bots.telegram,
    exactAdmissionMode,
  });
  return config;
}

export function createDirectMessageRouteShell(
  policy: BotRouteConfig["policy"] = "pairing",
): BotRouteConfig {
  return {
    enabled: true,
    requireMention: false,
    policy,
    allowUsers: [],
    blockUsers: [],
    allowBots: false,
  } satisfies BotRouteConfig;
}

function getProviderBot(
  config: ClisbotConfig,
  provider: Provider,
  botId: string,
): SlackBotConfig | TelegramBotConfig {
  const providerBots = provider === "slack" ? config.bots.slack : config.bots.telegram;
  const bot = providerBots[botId];
  if (!bot) {
    throw new Error(`Unknown ${provider === "slack" ? "Slack" : "Telegram"} bot: ${botId}`);
  }
  return bot;
}

export function ensureBotDirectMessageWildcardRoute(
  config: ClisbotConfig,
  provider: Provider,
  botId: string,
  policy: BotRouteConfig["policy"] = "pairing",
) {
  const bot = getProviderBot(config, provider, botId);
  const wildcardRoute = resolveDirectMessageWildcardRoute(bot.directMessages);
  if (wildcardRoute) {
    if (!bot.directMessages[DIRECT_MESSAGE_WILDCARD_ROUTE_ID]) {
      bot.directMessages[DIRECT_MESSAGE_WILDCARD_ROUTE_ID] = {
        ...createDirectMessageRouteShell(policy),
        ...wildcardRoute,
      };
      for (const legacyRouteId of LEGACY_DIRECT_MESSAGE_WILDCARD_ROUTE_IDS) {
        delete bot.directMessages[legacyRouteId];
      }
    }
    bot.directMessages = orderWildcardFirst(bot.directMessages);
    return bot.directMessages[DIRECT_MESSAGE_WILDCARD_ROUTE_ID]!;
  }

  const createdRoute = createDirectMessageRouteShell(policy);
  bot.directMessages = {
    [DIRECT_MESSAGE_WILDCARD_ROUTE_ID]: createdRoute,
    ...bot.directMessages,
  };
  return createdRoute;
}

export function createDirectMessageBehaviorOverride(
  wildcardRoute?: Partial<BotRouteConfig>,
): BotRouteConfig {
  return {
    ...createDirectMessageRouteShell(wildcardRoute?.policy ?? "pairing"),
    enabled: wildcardRoute?.enabled ?? true,
    policy: wildcardRoute?.policy,
    allowUsers: [...(wildcardRoute?.allowUsers ?? [])],
    blockUsers: [...(wildcardRoute?.blockUsers ?? [])],
    allowBots: wildcardRoute?.allowBots ?? false,
  } satisfies BotRouteConfig;
}
