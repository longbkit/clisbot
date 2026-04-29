import type { BotRouteConfig, TelegramBotConfig } from "./schema.ts";
import { getHostTimezone } from "./timezone.ts";
import {
  DIRECT_MESSAGE_WILDCARD_ROUTE_ID,
  createDirectMessageRouteShell,
  normalizeDirectMessageRouteId,
} from "./direct-message-routes.ts";
import {
  SHARED_GROUPS_WILDCARD_ROUTE_ID,
  createSlackGroupRouteShell,
  createTelegramGroupRouteShell,
  normalizeSharedGroupRouteId,
} from "./group-routes.ts";
import { migrateLegacyConfigShape } from "./legacy-config-migration.ts";

export const CURRENT_SCHEMA_VERSION = "0.1.45";
const CONFIG_UPGRADE_MAX_SCHEMA_VERSION = "0.1.44";

type Provider = "slack" | "telegram";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneRecord(value: unknown) {
  return isRecord(value) ? { ...value } : {};
}

function parseVersionParts(schemaVersion: string | undefined) {
  const raw = schemaVersion?.trim();
  if (!raw) {
    return undefined;
  }
  const parts = raw.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return undefined;
  }
  return parts as [number, number, number];
}

function isAtMostVersion(schemaVersion: string | undefined, maxVersion: string) {
  const current = parseVersionParts(schemaVersion);
  const max = parseVersionParts(maxVersion);
  if (!current || !max) {
    return !schemaVersion;
  }
  for (let index = 0; index < current.length; index += 1) {
    if (current[index] < max[index]) {
      return true;
    }
    if (current[index] > max[index]) {
      return false;
    }
  }
  return true;
}

function readTimezone(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function mergeAudienceEntries(...sources: Array<unknown>) {
  return [...new Set(
    sources.flatMap((source) =>
      Array.isArray(source)
        ? source.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean)
        : [],
    ),
  )];
}

function mergeRoute(
  base: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined,
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
  };
}

function orderWildcardFirst<TRoute>(
  routes: Record<string, TRoute>,
  wildcardRouteId: string,
) {
  const wildcardRoute = routes[wildcardRouteId];
  if (!wildcardRoute) {
    return routes;
  }
  return {
    [wildcardRouteId]: wildcardRoute,
    ...Object.fromEntries(
      Object.entries(routes).filter(([routeId]) => routeId !== wildcardRouteId),
    ),
  };
}

function stripLegacyDirectMessageAdmission(route: Record<string, unknown>) {
  const nextRoute = { ...route };
  delete nextRoute.enabled;
  delete nextRoute.policy;
  delete nextRoute.allowUsers;
  delete nextRoute.blockUsers;
  delete nextRoute.allowBots;
  return nextRoute;
}

function normalizeDirectMessages(params: {
  owner: Record<string, unknown>;
  legacyExactAdmission: boolean;
}) {
  const directMessages = cloneRecord(params.owner.directMessages);
  const nextRoutes: Record<string, Record<string, unknown>> = {};

  for (const [rawRouteId, rawRoute] of Object.entries(directMessages)) {
    if (!isRecord(rawRoute)) {
      continue;
    }
    const routeId = normalizeDirectMessageRouteId(rawRouteId);
    if (!routeId) {
      continue;
    }
    const normalizedRoute =
      params.legacyExactAdmission && routeId !== DIRECT_MESSAGE_WILDCARD_ROUTE_ID
        ? stripLegacyDirectMessageAdmission(rawRoute)
        : { ...rawRoute };
    nextRoutes[routeId] = {
      ...createDirectMessageRouteShell(),
      ...mergeRoute(nextRoutes[routeId], normalizedRoute),
    };
  }

  params.owner.directMessages = orderWildcardFirst(nextRoutes, DIRECT_MESSAGE_WILDCARD_ROUTE_ID);
}

function normalizeTelegramTopics(
  topics: unknown,
) {
  const nextTopics: Record<string, TelegramBotConfig["groups"][string]["topics"][string]> = {};
  for (const [topicId, rawRoute] of Object.entries(cloneRecord(topics))) {
    if (!isRecord(rawRoute)) {
      continue;
    }
    const normalizedTopicId = topicId.trim();
    if (!normalizedTopicId) {
      continue;
    }
    const normalizedRoute = {
      ...createSlackGroupRouteShell("open"),
      ...rawRoute,
    };
    if (!Object.hasOwn(rawRoute, "policy")) {
      delete (normalizedRoute as { policy?: unknown }).policy;
    }
    nextTopics[normalizedTopicId] = normalizedRoute;
  }
  return nextTopics;
}

function normalizeGroups(params: {
  provider: Provider;
  owner: Record<string, unknown>;
}) {
  const groups = cloneRecord(params.owner.groups);
  const nextRoutes: Record<string, Record<string, unknown>> = {};

  for (const [rawRouteId, rawRoute] of Object.entries(groups)) {
    if (!isRecord(rawRoute)) {
      continue;
    }
    const routeId = normalizeSharedGroupRouteId(params.provider, rawRouteId);
    if (!routeId) {
      continue;
    }
    const routeShell: Record<string, unknown> = params.provider === "telegram"
      ? createTelegramGroupRouteShell("open")
      : createSlackGroupRouteShell("open");
    if (routeId !== SHARED_GROUPS_WILDCARD_ROUTE_ID && !Object.hasOwn(rawRoute, "policy")) {
      delete routeShell.policy;
    }
    const normalizedRoute = params.provider === "telegram"
      ? {
          ...routeShell,
          ...rawRoute,
          topics: normalizeTelegramTopics(rawRoute.topics),
        }
      : {
          ...routeShell,
          ...rawRoute,
        };
    const existingTopics = params.provider === "telegram"
      ? (((nextRoutes[routeId]?.topics as Record<string, unknown> | undefined) ?? {}))
      : undefined;
    const normalizedTopics = params.provider === "telegram"
      ? ((normalizedRoute as TelegramBotConfig["groups"][string]).topics as Record<string, unknown>)
      : undefined;
    nextRoutes[routeId] = {
      ...routeShell,
      ...mergeRoute(nextRoutes[routeId], normalizedRoute),
      ...(params.provider === "telegram"
        ? {
            topics: {
              ...existingTopics,
              ...normalizedTopics,
            },
          }
        : {}),
    };
  }

  params.owner.groups = orderWildcardFirst(nextRoutes, SHARED_GROUPS_WILDCARD_ROUTE_ID);
}

function applySurfacePolicyToWildcardRoute(params: {
  route: Record<string, unknown>;
  policy: string;
}) {
  if (params.policy === "disabled") {
    params.route.enabled = false;
    params.route.policy = "disabled";
    return;
  }
  params.route.enabled = true;
  params.route.policy = params.policy;
}

function syncDmPolicy(
  owner: Record<string, unknown>,
  fallbackPolicy: NonNullable<BotRouteConfig["policy"]>,
) {
  normalizeDirectMessages({
    owner,
    legacyExactAdmission: false,
  });

  const directMessages = cloneRecord(owner.directMessages);
  const wildcardRoute = cloneRecord(directMessages[DIRECT_MESSAGE_WILDCARD_ROUTE_ID]);
  const configuredPolicy = typeof owner.dmPolicy === "string" ? owner.dmPolicy : undefined;
  const effectivePolicy = configuredPolicy ??
    (wildcardRoute.enabled === false || wildcardRoute.policy === "disabled"
      ? "disabled"
      : typeof wildcardRoute.policy === "string"
        ? wildcardRoute.policy
        : fallbackPolicy);

  const nextWildcardRoute = {
    ...createDirectMessageRouteShell(fallbackPolicy),
    ...wildcardRoute,
  };
  applySurfacePolicyToWildcardRoute({
    route: nextWildcardRoute,
    policy: effectivePolicy,
  });
  directMessages[DIRECT_MESSAGE_WILDCARD_ROUTE_ID] = nextWildcardRoute;
  owner.directMessages = orderWildcardFirst(directMessages, DIRECT_MESSAGE_WILDCARD_ROUTE_ID);
  owner.dmPolicy = effectivePolicy;
}

function readConversationPolicy(value: unknown) {
  return value === "disabled" || value === "allowlist" || value === "open"
    ? value
    : undefined;
}

function inferSharedAdmissionPolicy(
  wildcardRoute: Record<string, unknown>,
): "allowlist" | "open" {
  return wildcardRoute.policy === "open" && wildcardRoute.enabled !== false
    ? "open"
    : "allowlist";
}

function normalizeSharedWildcardRoutePolicy(
  route: Record<string, unknown>,
  fallbackPolicy: NonNullable<BotRouteConfig["policy"]>,
  legacyExactAdmission: boolean,
) {
  const routePolicy = route.policy;
  const policy =
    routePolicy === "disabled" && !legacyExactAdmission
      ? "disabled"
      : routePolicy === "open" || routePolicy === "allowlist"
        ? routePolicy
        : fallbackPolicy;
  route.enabled = policy !== "disabled";
  route.policy = policy;
}

function syncGroupPolicy(params: {
  provider: Provider;
  owner: Record<string, unknown>;
  fallbackPolicy: NonNullable<BotRouteConfig["policy"]>;
  legacyExactAdmission: boolean;
}) {
  normalizeGroups({
    provider: params.provider,
    owner: params.owner,
  });

  const groups = cloneRecord(params.owner.groups);
  const wildcardRoute = cloneRecord(groups[SHARED_GROUPS_WILDCARD_ROUTE_ID]);
  const inferredAdmissionPolicy = inferSharedAdmissionPolicy(wildcardRoute);
  const groupPolicy = readConversationPolicy(params.owner.groupPolicy) ??
    inferredAdmissionPolicy;
  const channelPolicy = params.provider === "slack"
    ? readConversationPolicy(params.owner.channelPolicy) ?? groupPolicy
    : undefined;

  const nextWildcardRoute = params.provider === "telegram"
    ? {
        ...createTelegramGroupRouteShell(params.fallbackPolicy),
        ...wildcardRoute,
      }
    : {
        ...createSlackGroupRouteShell(params.fallbackPolicy),
        ...wildcardRoute,
      };
  normalizeSharedWildcardRoutePolicy(
    nextWildcardRoute,
    params.fallbackPolicy,
    params.legacyExactAdmission,
  );
  groups[SHARED_GROUPS_WILDCARD_ROUTE_ID] = nextWildcardRoute;
  params.owner.groups = orderWildcardFirst(groups, SHARED_GROUPS_WILDCARD_ROUTE_ID);
  params.owner.groupPolicy = groupPolicy;
  if (params.provider === "slack") {
    params.owner.channelPolicy = channelPolicy;
  }
}

function normalizeProviderDefaults(provider: Provider, providerConfig: Record<string, unknown>) {
  const defaults = cloneRecord(providerConfig.defaults);
  syncDmPolicy(defaults, "pairing");
  syncGroupPolicy({
    provider,
    owner: defaults,
    fallbackPolicy: "open",
    legacyExactAdmission: false,
  });
  providerConfig.defaults = defaults;
}

function migrateTimezoneDefaults(config: Record<string, unknown>) {
  const app = cloneRecord(config.app);
  const control = cloneRecord(app.control);
  const loop = cloneRecord(control.loop);
  const bots = cloneRecord(config.bots);
  const botDefaults = cloneRecord(bots.defaults);
  const slack = cloneRecord(bots.slack);
  const telegram = cloneRecord(bots.telegram);
  const slackDefaults = cloneRecord(slack.defaults);
  const telegramDefaults = cloneRecord(telegram.defaults);

  app.timezone = readTimezone(app.timezone) ??
    readTimezone(loop.defaultTimezone) ??
    readTimezone(botDefaults.timezone) ??
    readTimezone(slackDefaults.timezone) ??
    readTimezone(telegramDefaults.timezone) ??
    getHostTimezone();

  delete loop.defaultTimezone;
  delete botDefaults.timezone;
  delete slackDefaults.timezone;
  delete telegramDefaults.timezone;

  control.loop = loop;
  app.control = control;
  bots.defaults = botDefaults;
  slack.defaults = slackDefaults;
  telegram.defaults = telegramDefaults;
  bots.slack = slack;
  bots.telegram = telegram;
  config.app = app;
  config.bots = bots;
}

function normalizeProviderBots(params: {
  provider: Provider;
  providerConfig: Record<string, unknown>;
  legacyExactAdmission: boolean;
}) {
  for (const [botId, rawBot] of Object.entries(params.providerConfig)) {
    if (botId === "defaults" || !isRecord(rawBot)) {
      continue;
    }
    normalizeDirectMessages({
      owner: rawBot,
      legacyExactAdmission: params.legacyExactAdmission,
    });
    normalizeGroups({
      provider: params.provider,
      owner: rawBot,
    });
    syncDmPolicy(rawBot, "pairing");
    syncGroupPolicy({
      provider: params.provider,
      owner: rawBot,
      fallbackPolicy: "open",
      legacyExactAdmission: params.legacyExactAdmission,
    });
  }
}

function updateSchemaVersion(config: Record<string, unknown>) {
  const meta = cloneRecord(config.meta);
  config.meta = {
    ...meta,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}

export function shouldUpgradeConfigSchema(schemaVersion: string | undefined) {
  return isAtMostVersion(schemaVersion, CONFIG_UPGRADE_MAX_SCHEMA_VERSION);
}

export function normalizeConfigDocumentShape(input: unknown) {
  if (!isRecord(input)) {
    return input;
  }

  const config = { ...input };
  migrateLegacyConfigShape(config);
  const schemaVersion = isRecord(config.meta) && typeof config.meta.schemaVersion === "string"
    ? config.meta.schemaVersion
    : undefined;
  const legacyExactAdmission = shouldUpgradeConfigSchema(schemaVersion);

  const bots = cloneRecord(config.bots);
  const slack = cloneRecord(bots.slack);
  const telegram = cloneRecord(bots.telegram);

  normalizeProviderDefaults("slack", slack);
  normalizeProviderDefaults("telegram", telegram);
  normalizeProviderBots({
    provider: "slack",
    providerConfig: slack,
    legacyExactAdmission,
  });
  normalizeProviderBots({
    provider: "telegram",
    providerConfig: telegram,
    legacyExactAdmission,
  });

  bots.slack = slack;
  bots.telegram = telegram;
  config.bots = bots;
  if (legacyExactAdmission) {
    migrateTimezoneDefaults(config);
  }
  updateSchemaVersion(config);
  return config;
}
