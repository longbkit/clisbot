// Route audience rules as the editor holds them: "[who] may talk in [where]",
// one row per rule (docs/audits/2026-09-19-route-audience-rules.md). Pure
// functions over the stored Route shape — no React — so the form, the row
// summaries and the tests read one definition.

import { routeContainsText, type ChannelConfigurationRecord } from "../channel-configuration";
import { splitConversationIds } from "../conversation-picker";
import { HUB_AUDIENCE_ROLES, type HubAudienceRole, type HubAudienceRule } from "../contracts";

export type AudienceGroups = NonNullable<HubAudienceRule["where"]["groups"]>;

/** One rule as the form edits it: lists as arrays, typed ids as the picker's comma-joined text. */
export interface AudienceRuleDraft {
  /** Row identity for the editor only; never sent to the Hub. */
  id: string;
  who: {
    roles: HubAudienceRole[];
    teams: string[];
    /** Membership ids. */
    members: string[];
    anyone: boolean;
    /** Channel identities outside the Hub, comma-separated. */
    identities: string;
  };
  where: {
    dm: boolean;
    groups: AudienceGroups;
    /** Native conversation ids, comma-separated (`ConversationSelectionFields`). */
    conversations: string;
  };
}

/** In a sentence: "Members may talk in …". */
export const AUDIENCE_ROLE_LABELS: Record<HubAudienceRole, string> = {
  owner: "Owners",
  admin: "Admins",
  member: "Members",
};

/**
 * On a chip, where the picker under it lists Members by name: "All Members"
 * says the role covers everyone who holds it, not some of them.
 */
export const AUDIENCE_ROLE_CHIP_LABELS: Record<HubAudienceRole, string> = {
  owner: "All Owners",
  admin: "All Admins",
  member: "All Members",
};

let ruleSequence = 0;
function nextRuleId(): string {
  ruleSequence += 1;
  return `rule-${String(ruleSequence)}`;
}

/** Every Member, everywhere: the one rule a new Route starts with. */
export function membersEverywhereRule(): AudienceRuleDraft {
  return {
    id: nextRuleId(),
    who: { roles: ["member"], teams: [], members: [], anyone: false, identities: "" },
    where: { dm: true, groups: "all", conversations: "" },
  };
}

/** An added row starts empty: the configurator names both halves. */
export function emptyAudienceRule(): AudienceRuleDraft {
  return {
    id: nextRuleId(),
    who: { roles: [], teams: [], members: [], anyone: false, identities: "" },
    where: { dm: false, groups: "off", conversations: "" },
  };
}

export function audienceRuleDraft(rule: HubAudienceRule): AudienceRuleDraft {
  return {
    id: nextRuleId(),
    who: {
      roles: HUB_AUDIENCE_ROLES.filter((role) => rule.who.roles?.includes(role) === true),
      teams: [...(rule.who.teams ?? [])],
      members: [...(rule.who.members ?? [])],
      anyone: rule.who.anyone === true,
      identities: (rule.who.identities ?? []).join(", "),
    },
    where: {
      dm: rule.where.dm === true,
      groups: rule.where.groups ?? "off",
      conversations: (rule.where.conversations ?? []).map(String).join(", "),
    },
  };
}

export function audienceRuleFromDraft(draft: AudienceRuleDraft): HubAudienceRule {
  // Anyone covers every sender, so a rule saved as Anyone carries nothing else.
  const who: HubAudienceRule["who"] = draft.who.anyone
    ? { roles: [], teams: [], members: [], anyone: true, identities: [] }
    : {
        roles: draft.who.roles,
        teams: draft.who.teams,
        members: draft.who.members,
        anyone: draft.who.anyone,
        identities: splitConversationIds(draft.who.identities),
      };
  return {
    who,
    where: {
      dm: draft.where.dm,
      groups: draft.where.groups,
      conversations: splitConversationIds(draft.where.conversations),
    },
  };
}

export function hasWhoPart(who: AudienceRuleDraft["who"]): boolean {
  return (
    who.anyone ||
    who.roles.length > 0 ||
    who.teams.length > 0 ||
    who.members.length > 0 ||
    splitConversationIds(who.identities).length > 0
  );
}

export function hasWherePart(where: AudienceRuleDraft["where"]): boolean {
  return where.dm || where.groups !== "off" || splitConversationIds(where.conversations).length > 0;
}

/** A Route needs one rule, and every rule needs a Who and a Where. */
export function audienceRulesComplete(rules: readonly AudienceRuleDraft[]): boolean {
  return (
    rules.length > 0 && rules.every((rule) => hasWhoPart(rule.who) && hasWherePart(rule.where))
  );
}

export function isOpenAudienceDraft(rules: readonly AudienceRuleDraft[]): boolean {
  return rules.some((rule) => rule.who.anyone);
}

// --- Stored shape → rules --------------------------------------------------------

/** What a stored Route authored: its audience rules and its `contains` filter. */
export function routeAudienceDraft(route: ChannelConfigurationRecord): {
  rules: AudienceRuleDraft[];
  contains: string;
} {
  return {
    rules: storedAudienceRules(route["audience"]),
    contains: routeContainsText(route) ?? "",
  };
}

function storedAudienceRules(audience: unknown): AudienceRuleDraft[] {
  if (!Array.isArray(audience)) return [];
  return audience.flatMap((rule) => {
    const record = recordValue(rule);
    if (record === null) return [];
    const who = recordValue(record["who"]) ?? {};
    const where = recordValue(record["where"]) ?? {};
    return [
      audienceRuleDraft({
        who: {
          roles: stringList(who["roles"]).filter(isAudienceRole),
          teams: stringList(who["teams"]),
          members: stringList(who["members"]),
          anyone: who["anyone"] === true,
          identities: stringList(who["identities"]),
        },
        where: {
          dm: where["dm"] === true,
          groups: audienceGroups(where["groups"]),
          conversations: stringList(where["conversations"]),
        },
      }),
    ];
  });
}

function isAudienceRole(value: string): value is HubAudienceRole {
  return (HUB_AUDIENCE_ROLES as readonly string[]).includes(value);
}

function audienceGroups(value: unknown): AudienceGroups {
  return value === "all" || value === "public" || value === "private" ? value : "off";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter(
          (item): item is string | number => typeof item === "string" || typeof item === "number",
        )
        .map(String)
    : [];
}

function recordValue(value: unknown): ChannelConfigurationRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as ChannelConfigurationRecord)
    : null;
}

// --- Channel facts ---------------------------------------------------------------

/**
 * The Hub catalog capability a channel claims when its inbound event states a
 * room's public/private visibility (`packages/hub/src/channels/catalog.ts`).
 * The Where filter is offered only there: elsewhere it matches nothing
 * (`packages/hub/src/channels/config/audience.ts` is the runtime side).
 */
export const VISIBILITY_CAPABILITY = "visibility";

export function channelReportsVisibility(
  entry: { capabilities: readonly string[] } | undefined,
): boolean {
  return entry?.capabilities.includes(VISIBILITY_CAPABILITY) === true;
}

/** A public-only or private-only group filter on a channel that never reports
 * visibility: that part of the rule matches no group chat. */
export function visibilityFilterMatchesNothing(
  where: AudienceRuleDraft["where"],
  reportsVisibility: boolean,
): boolean {
  return !reportsVisibility && (where.groups === "public" || where.groups === "private");
}

// --- Summaries ----------------------------------------------------------------------

/** Names for the ids a rule stores; unknown ids fall back to the id itself. */
export interface AudienceNames {
  teamName(id: string): string;
  memberName(id: string): string;
  conversationLabel(id: string): string;
}

export function audienceWhoLabel(who: AudienceRuleDraft["who"], names: AudienceNames): string {
  const parts = [
    ...who.roles.map((role) => AUDIENCE_ROLE_LABELS[role]),
    ...who.teams.map((id) => `Team ${names.teamName(id)}`),
    ...who.members.map((id) => names.memberName(id)),
    ...splitConversationIds(who.identities),
    ...(who.anyone ? ["Anyone"] : []),
  ];
  return parts.length === 0 ? "Nobody yet" : joinNatural(parts);
}

const GROUP_LABELS: Record<Exclude<AudienceGroups, "off">, string> = {
  all: "every group chat",
  public: "every public group chat",
  private: "every private group chat",
};

export function audienceWhereLabel(
  where: AudienceRuleDraft["where"],
  names: AudienceNames,
): string {
  const parts = [
    ...(where.dm ? ["DMs"] : []),
    ...(where.groups === "off" ? [] : [GROUP_LABELS[where.groups]]),
    ...splitConversationIds(where.conversations).map((id) => names.conversationLabel(id)),
  ];
  return parts.length === 0 ? "nowhere yet" : joinNatural(parts);
}

/** "Team QC may talk in every public group chat and #qc-private". */
export function audienceRuleSentence(rule: AudienceRuleDraft, names: AudienceNames): string {
  return `${audienceWhoLabel(rule.who, names)} may talk in ${audienceWhereLabel(rule.where, names)}`;
}

function joinNatural(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// --- Hub validation ---------------------------------------------------------------

/**
 * The rule each Hub validation line names, for the Route being edited. The
 * Hub renders issues as `<file>.routes.<i>.audience.<j>[.part]: <message>`;
 * other lines stay with the form.
 */
export function audienceRuleErrors(message: string, position: number): Map<number, string> {
  const errors = new Map<number, string>();
  const prefix = `routes\\.${String(position)}`;
  const pattern = new RegExp(`(?:^|\\.)${prefix}\\.audience\\.(\\d+)(?:\\.[^:]*)?: (.+)$`, "u");
  for (const line of message.split("\n")) {
    const found = pattern.exec(line.trim());
    if (found === null) continue;
    const index = Number(found[1]);
    if (!errors.has(index)) errors.set(index, found[2]!);
  }
  return errors;
}
