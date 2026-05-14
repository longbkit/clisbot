import type { BotRouteConfig } from "../core/schema.ts";

export const DIRECT_MESSAGE_WILDCARD_ROUTE_ID = "*";
export const LEGACY_DIRECT_MESSAGE_WILDCARD_ROUTE_IDS = ["dm:*", "dm:*".toUpperCase()];

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

function mergeAudienceEntries(...sources: Array<string[] | undefined>) {
  return [...new Set(
    sources.flatMap((source) => (source ?? []).map((entry) => entry.trim()).filter(Boolean)),
  )];
}

export function mergeDirectMessageRoute(
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

export function stripDirectMessageAdmissionFields(
  route: Partial<BotRouteConfig> | undefined,
) {
  if (!route) {
    return undefined;
  }

  const nextRoute = { ...route };
  delete nextRoute.enabled;
  delete nextRoute.policy;
  delete nextRoute.allowUsers;
  delete nextRoute.blockUsers;
  delete nextRoute.allowBots;
  return nextRoute;
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
  return mergeDirectMessageRoute(wildcardRoute, effectiveExactRoute);
}

export function createDirectMessageRouteShell(
  policy: NonNullable<BotRouteConfig["policy"]> = "pairing",
): BotRouteConfig {
  return {
    enabled: policy !== "disabled",
    requireMention: false,
    policy,
    allowUsers: [],
    blockUsers: [],
    allowBots: false,
  } satisfies BotRouteConfig;
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
