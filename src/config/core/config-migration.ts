import type { BotRouteConfig } from "./schema.ts";
import { SENSITIVE_CHANNEL_ACTION_PERMISSIONS } from "../../auth/defaults.ts";
import type { ChannelId } from "../../channels/integration/channel-surface-contract.ts";
import { getHostTimezone } from "../runtime/timezone.ts";
import {
  DIRECT_MESSAGE_WILDCARD_ROUTE_ID,
  createDirectMessageRouteShell,
  normalizeDirectMessageRouteId,
} from "../channels/direct-message-routes.ts";
import {
  SHARED_GROUPS_WILDCARD_ROUTE_ID,
  normalizeSharedGroupRouteId,
} from "../channels/group-routes.ts";
import { migrateLegacyConfigShape } from "../../channels/config/legacy-config-migration.ts";
import {
  channelSupportsTopicRoutes,
  createChannelGroupRouteShell,
  createChannelTopicRouteShell,
  listChannelRouteContracts,
  readChannelLegacyGroupPolicy,
  writeChannelLegacyGroupPolicy,
} from "../channels/channel-route-contract.ts";
import type {
  ChannelGroupRoute,
  ChannelTopicRoutes,
} from "../channels/channel-config-shapes.ts";

export const CURRENT_SCHEMA_VERSION = "0.1.53";
const LEGACY_CONFIG_UPGRADE_MAX_SCHEMA_VERSION = "0.1.44";

type Provider = ChannelId;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneRecord(value: unknown) {
  return isRecord(value) ? { ...value } : {};
}

function appendMissingStrings(target: unknown, values: readonly string[]) {
  const current = Array.isArray(target)
    ? target.filter((entry): entry is string => typeof entry === "string")
    : [];
  const next = [...current];
  for (const value of values) {
    if (!next.includes(value)) {
      next.push(value);
    }
  }
  return {
    changed: next.length !== current.length,
    values: next,
  };
}

function addSensitiveChannelPermissionsToAdminRole(role: unknown, options?: {
  requireExistingAllow?: boolean;
}) {
  if (!isRecord(role)) {
    return false;
  }
  if (options?.requireExistingAllow && !Array.isArray(role.allow)) {
    return false;
  }
  const nextAllow = appendMissingStrings(
    role.allow,
    SENSITIVE_CHANNEL_ACTION_PERMISSIONS,
  );
  if (!nextAllow.changed) {
    return false;
  }
  role.allow = nextAllow.values;
  return true;
}

export function addMissingSensitiveChannelAdminPermissions(input: unknown) {
  if (!isRecord(input)) {
    return false;
  }
  const agents = isRecord(input.agents) ? input.agents : undefined;
  const defaults = isRecord(agents?.defaults) ? agents.defaults : undefined;
  const defaultAuth = isRecord(defaults?.auth) ? defaults.auth : undefined;
  const defaultRoles = isRecord(defaultAuth?.roles) ? defaultAuth.roles : undefined;
  let changed = addSensitiveChannelPermissionsToAdminRole(defaultRoles?.admin);

  const agentList = Array.isArray(agents?.list) ? agents.list : [];
  for (const agent of agentList) {
    if (!isRecord(agent) || !isRecord(agent.auth) || !isRecord(agent.auth.roles)) {
      continue;
    }
    changed = addSensitiveChannelPermissionsToAdminRole(agent.auth.roles.admin, {
      requireExistingAllow: true,
    }) || changed;
  }

  return changed;
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

function isBeforeVersion(schemaVersion: string | undefined, targetVersion: string) {
  const current = parseVersionParts(schemaVersion);
  const target = parseVersionParts(targetVersion);
  if (!current || !target) {
    return !schemaVersion;
  }
  for (let index = 0; index < current.length; index += 1) {
    if (current[index] < target[index]) {
      return true;
    }
    if (current[index] > target[index]) {
      return false;
    }
  }
  return false;
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

function normalizeChannelTopics(
  provider: Provider,
  topics: unknown,
) {
  const nextTopics: ChannelTopicRoutes = {};
  for (const [topicId, rawRoute] of Object.entries(cloneRecord(topics))) {
    if (!isRecord(rawRoute)) {
      continue;
    }
    const normalizedTopicId = topicId.trim();
    if (!normalizedTopicId) {
      continue;
    }
    const normalizedRoute = {
      ...createChannelTopicRouteShell(provider),
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
  const supportsTopics = channelSupportsTopicRoutes(params.provider);

  for (const [rawRouteId, rawRoute] of Object.entries(groups)) {
    if (!isRecord(rawRoute)) {
      continue;
    }
    const routeId = normalizeSharedGroupRouteId(params.provider, rawRouteId);
    if (!routeId) {
      continue;
    }
    const routeShell: Record<string, unknown> = createChannelGroupRouteShell(
      params.provider,
      "open",
    ) as Record<string, unknown>;
    if (routeId !== SHARED_GROUPS_WILDCARD_ROUTE_ID && !Object.hasOwn(rawRoute, "policy")) {
      delete routeShell.policy;
    }
    const normalizedRoute = supportsTopics
      ? {
          ...routeShell,
          ...rawRoute,
          topics: normalizeChannelTopics(params.provider, rawRoute.topics),
        }
      : {
          ...routeShell,
          ...rawRoute,
        };
    const existingTopics = supportsTopics
      ? (((nextRoutes[routeId]?.topics as Record<string, unknown> | undefined) ?? {}))
      : undefined;
    const normalizedTopics = supportsTopics
      ? (((normalizedRoute as ChannelGroupRoute).topics ?? {}) as Record<string, unknown>)
      : undefined;
    nextRoutes[routeId] = {
      ...routeShell,
      ...mergeRoute(nextRoutes[routeId], normalizedRoute),
      ...(supportsTopics
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
  const hasWildcardRoute = Object.prototype.hasOwnProperty.call(
    directMessages,
    DIRECT_MESSAGE_WILDCARD_ROUTE_ID,
  );
  const wildcardRoute = cloneRecord(directMessages[DIRECT_MESSAGE_WILDCARD_ROUTE_ID]);
  const configuredPolicy = typeof owner.dmPolicy === "string" ? owner.dmPolicy : undefined;
  const wildcardPolicy =
    wildcardRoute.enabled === false || wildcardRoute.policy === "disabled"
      ? "disabled"
      : typeof wildcardRoute.policy === "string"
        ? wildcardRoute.policy
        : fallbackPolicy;
  const effectivePolicy = hasWildcardRoute ? wildcardPolicy : configuredPolicy ?? fallbackPolicy;
  if (!hasWildcardRoute && effectivePolicy === "disabled") {
    owner.directMessages = orderWildcardFirst(directMessages, DIRECT_MESSAGE_WILDCARD_ROUTE_ID);
    owner.dmPolicy = "disabled";
    return;
  }

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
  const legacyGroupPolicy = readConversationPolicy(
    readChannelLegacyGroupPolicy(params.provider, params.owner),
  ) ?? groupPolicy;

  const nextWildcardRoute = {
    ...createChannelGroupRouteShell(params.provider, params.fallbackPolicy),
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
  writeChannelLegacyGroupPolicy({
    channel: params.provider,
    owner: params.owner,
    policy: legacyGroupPolicy,
  });
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
  const providerDefaults = listChannelRouteContracts().map((contract) => {
    const providerConfig = cloneRecord(bots[contract.configBotKey]);
    const defaults = cloneRecord(providerConfig.defaults);
    bots[contract.configBotKey] = {
      ...providerConfig,
      defaults,
    };
    return defaults;
  });

  app.timezone = readTimezone(app.timezone) ??
    readTimezone(loop.defaultTimezone) ??
    readTimezone(botDefaults.timezone) ??
    providerDefaults.map((defaults) => readTimezone(defaults.timezone)).find(Boolean) ??
    getHostTimezone();

  delete loop.defaultTimezone;
  delete botDefaults.timezone;
  for (const defaults of providerDefaults) {
    delete defaults.timezone;
  }

  control.loop = loop;
  app.control = control;
  bots.defaults = botDefaults;
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
  return isBeforeVersion(schemaVersion, CURRENT_SCHEMA_VERSION);
}

export function shouldApplyLegacyConfigMigration(schemaVersion: string | undefined) {
  return isAtMostVersion(schemaVersion, LEGACY_CONFIG_UPGRADE_MAX_SCHEMA_VERSION);
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
  const legacyExactAdmission = shouldApplyLegacyConfigMigration(schemaVersion);

  const bots = cloneRecord(config.bots);
  for (const contract of listChannelRouteContracts()) {
    const providerConfig = cloneRecord(bots[contract.configBotKey]);
    bots[contract.configBotKey] = providerConfig;
    normalizeProviderDefaults(contract.channel, providerConfig);
    normalizeProviderBots({
      provider: contract.channel,
      providerConfig,
      legacyExactAdmission,
    });
  }
  config.bots = bots;
  if (legacyExactAdmission) {
    migrateTimezoneDefaults(config);
  }
  updateSchemaVersion(config);
  return config;
}
