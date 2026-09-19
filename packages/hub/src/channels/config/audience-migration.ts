// COMPAT(route-audience-rules): added 2026-09-19, remove after 2027-03-19.
//
// The migration table of docs/audits/2026-09-19-route-audience-rules.md as
// code. Two readers: the compiler, which folds an old-shape route (`match` +
// one-value `audience`) into rules on every load so stored revisions keep
// compiling; and the start-time job (`channels/access-migration.ts`), which
// rewrites account files to the new shape and folds `channel.use` grants in.

import type { AudienceRule, AudienceWhere, Fallback, Route, RouteMatch } from "./schema.js";

/** Every Member, everywhere — what `audience: members` and a bare fallback meant. */
export const MEMBERS_EVERYWHERE: AudienceRule = {
  who: { roles: ["member"] },
  where: { dm: true, groups: "all" },
};

/** What a Route or fallback authored, in the new shape whichever shape it used. */
export interface MigratedRouteAudience {
  rules: readonly AudienceRule[];
  contains?: string | undefined;
  /** True when the authored shape was the old one (`match` / `audience: {kind}`). */
  legacy: boolean;
}

/** `match.kind` + `ids` → the Where of the rule that replaces them. Threads and
 * topics belong to their room, so an id-less thread/topic route covers every
 * group chat, and a listed thread id narrows to that thread. */
export function whereFromMatch(match: RouteMatch): AudienceWhere {
  const ids = (match.ids ?? []).map(String);
  if (match.kind === "dm") return { dm: true };
  return ids.length === 0 ? { groups: "all" } : { conversations: ids };
}

export function migrateRouteAudience(route: Route): MigratedRouteAudience {
  if (Array.isArray(route.audience)) {
    return { rules: route.audience, contains: route.contains, legacy: false };
  }
  const contains = route.contains ?? route.match?.contains;
  const where = route.match === undefined ? MEMBERS_EVERYWHERE.where : whereFromMatch(route.match);
  const who: AudienceRule["who"] =
    route.audience?.kind === "conversationParticipants" ? { anyone: true } : { roles: ["member"] };
  return {
    rules: [{ who, where }],
    contains,
    legacy: route.match !== undefined || route.audience !== undefined,
  };
}

/** A catch-all fallback covers everything; only its Who was ever authored. */
export function migrateFallbackAudience(
  fallback: Exclude<Fallback, { deny: true }>,
): MigratedRouteAudience {
  if (Array.isArray(fallback.audience)) {
    return { rules: fallback.audience, legacy: false };
  }
  const who: AudienceRule["who"] =
    fallback.audience?.kind === "conversationParticipants"
      ? { anyone: true }
      : { roles: ["member"] };
  return {
    rules: [{ who, where: MEMBERS_EVERYWHERE.where }],
    legacy: fallback.audience !== undefined,
  };
}

/** One `channel.use` grant's conversation scope as a rule's Where. */
export function whereFromChannelUseConstraint(
  conversation:
    | { kind: "all" }
    | { kind: "direct_messages" }
    | { kind: "public_channels" }
    | { kind: "specific"; conversationIds: readonly string[] }
    | undefined,
): AudienceWhere | undefined {
  if (conversation === undefined) return undefined;
  if (conversation.kind === "all") return { dm: true, groups: "all" };
  if (conversation.kind === "direct_messages") return { dm: true };
  if (conversation.kind === "public_channels") return { groups: "public" };
  return conversation.conversationIds.length === 0
    ? undefined
    : { conversations: [...conversation.conversationIds] };
}

/** The grant's subject as a Who: a Member, a Team, or the Guest subject (anyone). */
export function whoFromChannelUseSubject(
  subjectKind: "member" | "team" | "guest",
  subjectId: string,
): AudienceRule["who"] {
  if (subjectKind === "member") return { members: [subjectId] };
  if (subjectKind === "team") return { teams: [subjectId] };
  return { anyone: true };
}

/** A route in the new shape: rules on `audience`, `contains` at route level, no `match`. */
export function routeInNewShape(route: Route): Route {
  const migrated = migrateRouteAudience(route);
  const { match: _match, contains: _contains, audience: _audience, ...rest } = route;
  return {
    ...rest,
    audience: [...migrated.rules],
    ...(migrated.contains === undefined ? {} : { contains: migrated.contains }),
  };
}

export function fallbackInNewShape(fallback: Fallback): Fallback {
  if ("deny" in fallback) return fallback;
  const { audience: _audience, ...rest } = fallback;
  return { ...rest, audience: [...migrateFallbackAudience(fallback).rules] };
}

/** Append one rule to a route or fallback already in the new shape. */
export function appendAudienceRule<T extends { audience?: Route["audience"] }>(
  target: T,
  rule: AudienceRule,
): T {
  const rules = Array.isArray(target.audience) ? target.audience : [];
  return { ...target, audience: [...rules, rule] };
}
