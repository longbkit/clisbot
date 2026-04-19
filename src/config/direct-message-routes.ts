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

const DIRECT_MESSAGE_WILDCARD_ROUTE_ID = "dm:*";
const LEGACY_DIRECT_MESSAGE_WILDCARD_ROUTE_ID = "*";
const DIRECT_MESSAGE_ADMISSION_FIELDS = [
  "enabled",
  "policy",
  "allowUsers",
  "blockUsers",
] as const;

export function isDirectMessageWildcardRouteId(routeId: string) {
  const normalized = routeId.trim();
  return normalized === DIRECT_MESSAGE_WILDCARD_ROUTE_ID || normalized === LEGACY_DIRECT_MESSAGE_WILDCARD_ROUTE_ID;
}

export function isExactDirectMessageRouteId(routeId: string) {
  const normalized = routeId.trim();
  return normalized.startsWith("dm:") && !isDirectMessageWildcardRouteId(normalized);
}

export function normalizeDirectMessageRouteId(routeId: string) {
  const normalized = routeId.trim();
  if (!normalized) {
    return "";
  }
  if (normalized === LEGACY_DIRECT_MESSAGE_WILDCARD_ROUTE_ID) {
    return DIRECT_MESSAGE_WILDCARD_ROUTE_ID;
  }
  if (normalized.startsWith("dm:")) {
    const subjectId = normalized.slice(3).trim();
    return subjectId ? `dm:${subjectId}` : "";
  }
  return `dm:${normalized}`;
}

export function resolveDirectMessageWildcardRoute(
  routes: Record<string, Partial<BotRouteConfig>>,
) {
  return routes[DIRECT_MESSAGE_WILDCARD_ROUTE_ID] ?? routes[LEGACY_DIRECT_MESSAGE_WILDCARD_ROUTE_ID];
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

  return routes[`dm:${normalizedSubjectId}`] ?? routes[normalizedSubjectId];
}

function stripDirectMessageAdmissionFields(route: Partial<BotRouteConfig> | undefined) {
  if (!route) {
    return undefined;
  }

  const nextRoute = { ...route };
  for (const field of DIRECT_MESSAGE_ADMISSION_FIELDS) {
    delete (nextRoute as Partial<BotRouteConfig>)[field];
  }
  return nextRoute;
}

export function resolveEffectiveDirectMessageRoute(
  routes: Record<string, Partial<BotRouteConfig>>,
  subjectId?: string | number | null,
) {
  const wildcardRoute = resolveDirectMessageWildcardRoute(routes);
  const exactRoute = stripDirectMessageAdmissionFields(
    resolveDirectMessageExactRoute(routes, subjectId),
  );

  if (!exactRoute) {
    return wildcardRoute;
  }

  return {
    ...(wildcardRoute ?? {}),
    ...exactRoute,
  } satisfies Partial<BotRouteConfig>;
}

function mergeRoutes(
  existingRoute: BotRouteConfig | undefined,
  nextRoute: BotRouteConfig,
) {
  if (!existingRoute) {
    return { ...nextRoute };
  }
  return {
    ...existingRoute,
    ...nextRoute,
  } satisfies BotRouteConfig;
}

function normalizeDirectMessageRouteMap(owner: DirectMessageRouteOwner) {
  const nextRoutes: Record<string, BotRouteConfig> = {};

  for (const [routeId, route] of Object.entries(owner.directMessages ?? {})) {
    const normalizedRouteId = normalizeDirectMessageRouteId(routeId);
    if (!normalizedRouteId) {
      continue;
    }

    const normalizedRoute = isExactDirectMessageRouteId(normalizedRouteId)
      ? stripDirectMessageAdmissionFields(route) ?? {}
      : route;

    nextRoutes[normalizedRouteId] = mergeRoutes(
      nextRoutes[normalizedRouteId],
      normalizedRoute as BotRouteConfig,
    );
  }

  owner.directMessages = nextRoutes;
}

function normalizeProviderDirectMessageRoutes<TConfig extends {
  defaults: DirectMessageRouteOwner;
}>(providerConfig: TConfig) {
  normalizeDirectMessageRouteMap(providerConfig.defaults);

  for (const [botId, botConfig] of Object.entries(providerConfig)) {
    if (botId === "defaults") {
      continue;
    }
    normalizeDirectMessageRouteMap(botConfig as DirectMessageRouteOwner);
  }
}

export function normalizeConfigDirectMessageRoutes(config: ClisbotConfig) {
  normalizeProviderDirectMessageRoutes(config.bots.slack);
  normalizeProviderDirectMessageRoutes(config.bots.telegram);
  return config;
}

function createDirectMessageWildcardRoute(): BotRouteConfig {
  return {
    enabled: true,
    requireMention: false,
    policy: "pairing",
    allowUsers: [],
    blockUsers: [],
    allowBots: false,
  };
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
) {
  const bot = getProviderBot(config, provider, botId);
  const wildcardRoute = resolveDirectMessageWildcardRoute(bot.directMessages);
  if (wildcardRoute) {
    if (!bot.directMessages[DIRECT_MESSAGE_WILDCARD_ROUTE_ID]) {
      bot.directMessages[DIRECT_MESSAGE_WILDCARD_ROUTE_ID] = {
        ...createDirectMessageWildcardRoute(),
        ...wildcardRoute,
      };
      delete bot.directMessages[LEGACY_DIRECT_MESSAGE_WILDCARD_ROUTE_ID];
    }
    return bot.directMessages[DIRECT_MESSAGE_WILDCARD_ROUTE_ID]!;
  }

  const createdRoute = createDirectMessageWildcardRoute();
  bot.directMessages[DIRECT_MESSAGE_WILDCARD_ROUTE_ID] = createdRoute;
  return createdRoute;
}

export function createDirectMessageBehaviorOverride(): BotRouteConfig {
  return {
    enabled: true,
    allowUsers: [],
    blockUsers: [],
  };
}
