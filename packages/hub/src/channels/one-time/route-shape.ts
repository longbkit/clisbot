// ONE-TIME: delete this folder once `migrate-channel-routes-once.ts` has run on
// every Hub that holds data (dev, ai-cowork).
//
// The pure half of the move to audience rules without a catch-all
// (docs/audits/2026-09-19-route-audience-rules.md#migration-one-time-then-deleted):
// one stored account file in any old shape → the only shape the Hub reads now.
// The old shapes are typed here and nowhere else.

import { z } from "zod";
import {
  AccountFileSchema,
  AudienceRuleSchema,
  type AccountFile,
  type AudienceRule,
  type AudienceWhere,
} from "../config/schema.js";

/** One `channel.use` Access grant on a Channel account, as stored. */
export interface ChannelUseGrant {
  id: string;
  subjectKind: "member" | "team" | "guest";
  subjectId: string;
  channel: string;
  accountId: string;
  conversation:
    | { kind: "all" }
    | { kind: "direct_messages" }
    | { kind: "public_channels" }
    | { kind: "specific"; conversationIds: string[] }
    | undefined;
}

export interface ConvertedAccount {
  account: AccountFile;
  /** Where the old catch-all now sits in `routes`; undefined when it was off. */
  fallbackPosition: number | undefined;
  /** Grants whose `channel.use` is now expressed as rules. */
  foldedGrantIds: string[];
}

// The old shapes, loose: every other key passes through untouched.
const LegacyMatchSchema = z.object({
  kind: z.string(),
  ids: z.array(z.union([z.string(), z.number()])).optional(),
  contains: z.string().optional(),
});
const LegacyRouteSchema = z.looseObject({
  match: LegacyMatchSchema.optional(),
  audience: z.unknown().optional(),
  contains: z.string().optional(),
});
const LegacyAccountSchema = z.looseObject({
  routes: z.array(LegacyRouteSchema).optional(),
  fallback: z.union([z.object({ deny: z.literal(true) }), LegacyRouteSchema]).optional(),
});
const RulesSchema = z.array(AudienceRuleSchema);

type LegacyRoute = z.infer<typeof LegacyRouteSchema>;
/** A route in the new shape as far as this file cares: rules on `audience`. */
type RuleRoute = Omit<LegacyRoute, "audience" | "match"> & { audience: AudienceRule[] };

const EVERYWHERE: AudienceWhere = { dm: true, groups: "all" };

export function convertAccountFile(
  raw: unknown,
  grants: readonly ChannelUseGrant[],
): ConvertedAccount {
  const { routes: legacyRoutes, fallback, ...account } = LegacyAccountSchema.parse(raw);
  const routes = (legacyRoutes ?? []).map(routeInNewShape);
  const catchAll =
    fallback === undefined || "deny" in fallback ? undefined : fallbackAsRoute(fallback);
  const fallbackPosition = catchAll === undefined ? undefined : routes.length;
  if (catchAll !== undefined) routes.push(catchAll);
  const folded = foldGrants(routes, grants);
  const converted = AccountFileSchema.parse({
    ...account,
    ...(legacyRoutes === undefined && catchAll === undefined ? {} : { routes: folded.routes }),
  });
  return { account: converted, fallbackPosition, foldedGrantIds: folded.grantIds };
}

/** `match` + one-value `audience` → rules; a route already in rules is kept. */
function routeInNewShape(route: LegacyRoute): RuleRoute {
  const { match, audience, contains, ...rest } = route;
  const rules = RulesSchema.safeParse(audience);
  if (rules.success) return { ...rest, audience: rules.data, ...definedContains(contains) };
  const where = match === undefined ? EVERYWHERE : whereFromMatch(match);
  return {
    ...rest,
    audience: [{ who: legacyWho(audience), where }],
    ...definedContains(contains ?? match?.contains),
  };
}

function definedContains(contains: string | undefined): { contains?: string } {
  return contains === undefined ? {} : { contains };
}

/** The catch-all becomes a last Route covering everything. */
function fallbackAsRoute(fallback: LegacyRoute): RuleRoute {
  const { audience, match: _match, contains: _contains, ...rest } = fallback;
  const rules = RulesSchema.safeParse(audience);
  return {
    ...rest,
    audience: rules.success ? rules.data : [{ who: legacyWho(audience), where: EVERYWHERE }],
  };
}

function legacyWho(audience: unknown): AudienceRule["who"] {
  const parsed = z.object({ kind: z.string() }).safeParse(audience);
  return parsed.success && parsed.data.kind === "conversationParticipants"
    ? { anyone: true }
    : { roles: ["member"] };
}

/** Threads and topics belong to their room: an id-less thread route covers every group. */
function whereFromMatch(match: z.infer<typeof LegacyMatchSchema>): AudienceWhere {
  const ids = (match.ids ?? []).map(String);
  if (match.kind === "dm") return { dm: true };
  return ids.length === 0 ? { groups: "all" } : { conversations: ids };
}

/**
 * A grant widens Who only. Each of its rules takes the intersection of the
 * grant's scope with one existing rule's Where, so a Route's Where (the union
 * of its rules') never grows and an "all" grant cannot pull later Routes'
 * conversations into Route 1.
 */
function foldGrants(
  routes: readonly RuleRoute[],
  grants: readonly ChannelUseGrant[],
): { routes: RuleRoute[]; grantIds: string[] } {
  const grantIds: string[] = [];
  const folded = routes.map((route) => ({ ...route }));
  for (const grant of grants) {
    const scope = whereFromGrant(grant.conversation);
    if (scope === undefined) continue;
    grantIds.push(grant.id);
    const who = whoFromGrant(grant);
    for (const route of folded) {
      const added = uniqueWheres(route.audience.map((rule) => intersectWhere(scope, rule.where)));
      route.audience = [...route.audience, ...added.map((where) => ({ who, where }))];
    }
  }
  return { routes: folded, grantIds };
}

function whereFromGrant(conversation: ChannelUseGrant["conversation"]): AudienceWhere | undefined {
  if (conversation === undefined) return undefined;
  if (conversation.kind === "all") return EVERYWHERE;
  if (conversation.kind === "direct_messages") return { dm: true };
  if (conversation.kind === "public_channels") return { groups: "public" };
  return conversation.conversationIds.length === 0
    ? undefined
    : { conversations: [...conversation.conversationIds] };
}

function whoFromGrant(grant: ChannelUseGrant): AudienceRule["who"] {
  if (grant.subjectKind === "member") return { members: [grant.subjectId] };
  if (grant.subjectKind === "team") return { teams: [grant.subjectId] };
  return { anyone: true };
}

type GroupFilter = NonNullable<AudienceWhere["groups"]>;

/**
 * The conversations both Wheres cover, or undefined when none. A listed id
 * survives when the other side lists it too or covers every group chat; a
 * public/private filter cannot vouch for a listed id, whose visibility is
 * unknown here, so it does not.
 */
export function intersectWhere(a: AudienceWhere, b: AudienceWhere): AudienceWhere | undefined {
  const dm = a.dm === true && b.dm === true;
  const groups = intersectGroups(a.groups, b.groups);
  const conversations = [...new Set([...listedCoveredBy(a, b), ...listedCoveredBy(b, a)])];
  if (!dm && groups === undefined && conversations.length === 0) return undefined;
  return {
    ...(dm ? { dm } : {}),
    ...(groups === undefined ? {} : { groups }),
    ...(conversations.length === 0 ? {} : { conversations }),
  };
}

function intersectGroups(
  a: AudienceWhere["groups"],
  b: AudienceWhere["groups"],
): GroupFilter | undefined {
  if (a === undefined || b === undefined || a === "off" || b === "off") return undefined;
  if (a === "all") return b;
  if (b === "all" || a === b) return a;
  return undefined;
}

function listedCoveredBy(listing: AudienceWhere, other: AudienceWhere): string[] {
  const others = new Set((other.conversations ?? []).map(String));
  return (listing.conversations ?? [])
    .map(String)
    .filter((id) => others.has(id) || other.groups === "all");
}

function uniqueWheres(wheres: readonly (AudienceWhere | undefined)[]): AudienceWhere[] {
  const seen = new Map<string, AudienceWhere>();
  for (const where of wheres) {
    if (where !== undefined) seen.set(JSON.stringify(where), where);
  }
  return [...seen.values()];
}
