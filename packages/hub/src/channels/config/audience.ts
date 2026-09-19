// Route audience rules as the runtime reads them: "[who] may talk in [where]",
// one sentence per rule, a sender admitted when any rule matches
// (docs/audits/2026-09-19-route-audience-rules.md). Pure functions over the
// compiled shape — no IO — so the compiler, the policy engine, the gate and
// the configuration warnings all read one definition of "covers".

import type { AudienceRole, AudienceRule } from "./schema.js";

/** The group-chat filters a Where can ask for; `off` never reaches here. */
export type GroupFilter = "all" | "public" | "private";

/** A Where with ids normalized to strings and `groups: off` dropped. */
export interface CompiledWhere {
  dm: boolean;
  /** Absent = the rule covers no group chat by kind (only `conversations`). */
  groups?: GroupFilter;
  conversations: readonly string[];
}

export interface CompiledWho {
  roles: readonly AudienceRole[];
  teams: readonly string[];
  members: readonly string[];
  anyone: boolean;
  identities: readonly string[];
}

export interface CompiledAudienceRule {
  who: CompiledWho;
  where: CompiledWhere;
}

/** The union of every rule's Where: which conversations the Route applies to. */
export interface RouteWhere {
  dm: boolean;
  /** Every group filter some rule asked for; empty = no rule covers group chats by kind. */
  groups: readonly GroupFilter[];
  conversations: readonly string[];
}

/** What the audience needs to know about the conversation an inbound sits in. */
export interface AudienceConversation {
  kind: "dm" | "channel" | "thread" | "group" | "topic";
  /** The conversation's own id (thread ts / topic id at thread level). */
  id: string;
  /** The room a thread/topic belongs to; absent = `id` is the room. */
  rootConversationId?: string | undefined;
  /** Reported by the vertical when it can (Slack); absent = unknown. */
  visibility?: "public" | "private" | undefined;
}

/** What the audience needs to know about the sender: their Hub Member facts,
 * or null when the channel identity is not linked to a Member. */
export interface AudienceSender {
  identity: string;
  member: { membershipId: string; role: string; teamIds: readonly string[] } | null;
}

export function compileAudienceRule(rule: AudienceRule): CompiledAudienceRule {
  const groups = rule.where.groups;
  return {
    who: {
      roles: rule.who.roles ?? [],
      teams: rule.who.teams ?? [],
      members: rule.who.members ?? [],
      anyone: rule.who.anyone === true,
      identities: rule.who.identities ?? [],
    },
    where: {
      dm: rule.where.dm === true,
      ...(groups === undefined || groups === "off" ? {} : { groups }),
      conversations: (rule.where.conversations ?? []).map(String),
    },
  };
}

export function deriveRouteWhere(rules: readonly CompiledAudienceRule[]): RouteWhere {
  const groups = new Set<GroupFilter>();
  const conversations = new Set<string>();
  let dm = false;
  for (const { where } of rules) {
    dm ||= where.dm;
    if (where.groups !== undefined) groups.add(where.groups);
    for (const id of where.conversations) conversations.add(id);
  }
  return { dm, groups: [...groups], conversations: [...conversations] };
}

/** Does a Where (one rule's, or a Route's union) cover this conversation? */
export function whereCovers(
  where: {
    dm: boolean;
    groups?: GroupFilter | readonly GroupFilter[] | undefined;
    conversations: readonly string[];
  },
  conversation: AudienceConversation,
): boolean {
  const room = conversation.rootConversationId ?? conversation.id;
  if (where.conversations.includes(conversation.id) || where.conversations.includes(room)) {
    return true;
  }
  if (conversation.kind === "dm") return where.dm;
  const filters = groupFilters(where.groups);
  return filters.some(
    (filter) =>
      filter === "all" ||
      (conversation.visibility !== undefined && filter === conversation.visibility),
  );
}

function groupFilters(
  groups: GroupFilter | readonly GroupFilter[] | undefined,
): readonly GroupFilter[] {
  if (groups === undefined) return [];
  if (typeof groups === "string") return [groups];
  return groups;
}

/** Does a Who name this sender? Roles resolve per message: `admin` includes
 * Owners, `member` is every linked Member. */
export function whoMatches(who: CompiledWho, sender: AudienceSender): boolean {
  if (who.anyone) return true;
  if (who.identities.some((identity) => identityNames(identity, sender.identity))) return true;
  const member = sender.member;
  if (member === null) return false;
  if (who.members.includes(member.membershipId)) return true;
  if (who.teams.some((team) => member.teamIds.includes(team))) return true;
  return who.roles.some((role) => roleCovers(role, member.role));
}

function roleCovers(wanted: AudienceRole, actual: string): boolean {
  if (wanted === "member") return true;
  if (wanted === "admin") return actual === "admin" || actual === "owner";
  return actual === "owner";
}

/** `slack:U0…` and the bare `U0…` both name the same identity. */
function identityNames(configured: string, identity: string): boolean {
  if (configured === identity) return true;
  const separator = identity.indexOf(":");
  return separator > 0 && identity.slice(separator + 1) === configured;
}

/** The rules whose Where covers the conversation — the ones a sender is tested against. */
export function rulesCovering(
  rules: readonly CompiledAudienceRule[],
  conversation: AudienceConversation,
): CompiledAudienceRule[] {
  return rules.filter((rule) => whereCovers(rule.where, conversation));
}

/** True when any rule opens the Route to everyone somewhere. */
export function isOpenAudience(rules: readonly CompiledAudienceRule[]): boolean {
  return rules.some((rule) => rule.who.anyone);
}

/** Whether any covering rule needs the sender's Member facts to decide. */
export function needsSenderFacts(rules: readonly CompiledAudienceRule[]): boolean {
  return rules.some(
    ({ who }) =>
      !who.anyone && (who.roles.length > 0 || who.teams.length > 0 || who.members.length > 0),
  );
}
