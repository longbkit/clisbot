// A Route's Rules as the editor holds them (docs/audits/2026-10-05-routes-and-rules.md):
// each Rule is one way into the Route — a place (direct messages, or group
// chats), who may talk there, and when a message gets in (a mention, the
// follow-up window, a text filter). Pure functions over the stored Route shape
// — no React — so the form, the row summaries and the tests read one definition.

import {
  parseChannelFollowUpTtlMinutes,
  type ChannelConfigurationRecord,
  type ChannelLimits,
} from "../channel-configuration";
import { splitConversationIds } from "../conversation-picker";
import { HUB_AUDIENCE_ROLES, type HubAudienceRole, type HubAudienceRule } from "../contracts";
import {
  RULE_LIMIT_NAMES,
  channelLimitsDraft,
  parseChannelLimitsDraft,
  type ChannelLimitsDraft,
} from "./channel-limits-draft";

export type AudienceGroups = NonNullable<HubAudienceRule["where"]["groups"]>;
export type FollowUpMode = "auto" | "mention-only";

/** Where a Rule applies: one kind of place per Rule. */
export type RulePlace = "dm" | "groups";

/**
 * Who, as one choice from narrow to wide. Roles nest on the Hub (`admin`
 * includes Owners, `member` is every Member), so they are a ladder, not chips.
 */
export type WhoChoice = "owners" | "admins" | "everyone" | "pick" | "anyone";

/** A Rule's own conditions; an absent leaf inherits the Connection's and organization's. */
export interface RuleConditionsDraft {
  requireMention?: boolean;
  followUpMode?: FollowUpMode;
  /** Typed minutes for the follow-up window. */
  ttlMinutes?: string;
  /** Absent = every message; a string = only messages containing it. */
  contains?: string;
}

/** What a Rule that sets no condition meets: the Connection's, then the organization's. */
export interface InheritedConditions {
  requireMention: boolean;
  followUpMode: FollowUpMode;
  ttlMinutes: number;
}

/** One Rule as the form edits it: lists as arrays, typed ids as comma-joined text. */
export interface AudienceRuleDraft {
  /** Row identity for the editor only; never sent to the Hub. */
  id: string;
  place: RulePlace;
  who: {
    roles: HubAudienceRole[];
    teams: string[];
    /** Membership ids. */
    members: string[];
    anyone: boolean;
    /** Channel identities outside the Hub, comma-separated. */
    identities: string;
  };
  /** The person picked "Only people I pick": stays there even before anyone is named. */
  picking: boolean;
  where: {
    /** A DM Rule: every DM with someone the Who names; `specific` only in a stored
     * Rule that narrowed DMs to named people (no longer offered). */
    dm: AudienceDmScope;
    dmMembers: string[];
    dmTeams: string[];
    dmIdentities: string;
    /** A group-chats Rule: every group chat, a visibility filter, or the named ones. */
    groups: AudienceGroupScope;
    /** Native conversation ids, comma-separated (`ConversationSelectionFields`). */
    conversations: string;
  };
  conditions: RuleConditionsDraft;
  /** Its own limits; a leaf left at its default meets the Route's, then for an
   * Anyone Rule the open-Route defaults (`ruleLimitDefaults`). */
  limits: ChannelLimitsDraft;
  /** The Rule as stored. An untouched Rule is written back exactly as it was. */
  stored?: ChannelConfigurationRecord;
  edited: boolean;
}

export type AudienceDmScope = "off" | "all" | "specific";
/** The stored `groups` values plus `specific`: `groups: off` with `conversations`. */
export type AudienceGroupScope = AudienceGroups | "specific";

/** In a sentence and a summary: "Members may talk in …". */
export const AUDIENCE_ROLE_LABELS: Record<HubAudienceRole, string> = {
  owner: "Owners",
  admin: "Owners and admins",
  member: "Everyone on the Hub",
};

export const WHO_CHOICE_LABELS: Record<Exclude<WhoChoice, "anyone">, string> = {
  owners: "Only owners",
  admins: "Owners and admins",
  everyone: "Everyone on the Hub",
  pick: "Only people I pick",
};

const EMPTY_STORED: ChannelConfigurationRecord = {};

let ruleSequence = 0;
function nextRuleId(): string {
  ruleSequence += 1;
  return `rule-${String(ruleSequence)}`;
}

const NO_WHERE: AudienceRuleDraft["where"] = {
  dm: "off",
  dmMembers: [],
  dmTeams: [],
  dmIdentities: "",
  groups: "off",
  conversations: "",
};

/**
 * A new Rule: the Hub's owners in direct messages, answered without a mention.
 * Switched to group chats it needs a mention there.
 */
export function newAudienceRule(place: RulePlace = "dm"): AudienceRuleDraft {
  return {
    id: nextRuleId(),
    place,
    who: whoForChoice("owners"),
    picking: false,
    where: placeWhere(place),
    conditions: placeConditions(place),
    limits: channelLimitsDraft(undefined),
    edited: true,
  };
}

function placeWhere(place: RulePlace): AudienceRuleDraft["where"] {
  return place === "dm" ? { ...NO_WHERE, dm: "all" } : { ...NO_WHERE, groups: "specific" };
}

/** A place's starting conditions: a DM is answered without a mention, a group chat with one. */
function placeConditions(place: RulePlace): RuleConditionsDraft {
  return place === "dm"
    ? { requireMention: false }
    : { requireMention: true, followUpMode: "mention-only" };
}

/** The Rule moved to the other kind of place: its Where and mention start over there. */
export function withPlace(rule: AudienceRuleDraft, place: RulePlace): AudienceRuleDraft {
  if (rule.place === place) return rule;
  const { contains } = rule.conditions;
  return {
    ...rule,
    place,
    where: placeWhere(place),
    conditions: { ...placeConditions(place), ...(contains === undefined ? {} : { contains }) },
  };
}

// --- Who -------------------------------------------------------------------------

const CHOICE_ROLES: Record<"owners" | "admins" | "everyone", HubAudienceRole> = {
  owners: "owner",
  admins: "admin",
  everyone: "member",
};

export function whoForChoice(choice: Exclude<WhoChoice, "pick">): AudienceRuleDraft["who"] {
  const none = { roles: [], teams: [], members: [], anyone: false, identities: "" };
  if (choice === "anyone") return { ...none, anyone: true };
  return { ...none, roles: [CHOICE_ROLES[choice]] };
}

/** The choice a Who reads as. Anything beyond one role is people picked by hand. */
export function whoChoiceOf(
  rule: Pick<AudienceRuleDraft, "who" | "picking"> & { where?: AudienceRuleDraft["where"] },
): WhoChoice {
  const { who } = rule;
  if (who.anyone) return "anyone";
  // An older Rule that narrowed DMs lets in only the people it named there.
  if (rule.picking || rule.where?.dm === "specific") return "pick";
  const named = who.teams.length + who.members.length + splitConversationIds(who.identities).length;
  if (named > 0 || who.roles.length === 0) return "pick";
  if (who.roles.includes("member")) return who.roles.length === 1 ? "everyone" : "pick";
  if (who.roles.includes("admin")) return "admins";
  return "owners";
}

// --- Stored shape → drafts --------------------------------------------------------

/** What a stored Route authored: its Rules, a Rule over DMs and group chats split in two. */
export function routeAudienceDraft(route: ChannelConfigurationRecord): AudienceRuleDraft[] {
  const audience = route["audience"];
  if (!Array.isArray(audience)) return [];
  return audience.flatMap((rule) => {
    const record = recordValue(rule);
    return record === null ? [] : storedRuleDrafts(record);
  });
}

/**
 * One stored Rule as the editor shows it. A Rule over DMs and group chats
 * becomes two (the same people, the same conditions): a sender gets in through
 * any Rule, so the meaning is unchanged.
 */
function storedRuleDrafts(stored: ChannelConfigurationRecord): AudienceRuleDraft[] {
  const where = storedWhere(recordValue(stored["where"]) ?? {});
  const base = {
    who: storedWho(recordValue(stored["who"]) ?? {}),
    picking: false,
    conditions: storedConditions(stored),
    limits: channelLimitsDraft(stored["limits"]),
    stored,
  };
  const dm = where.dm !== "off";
  const groups = where.groups !== "off";
  if (dm && groups) {
    return [
      {
        ...base,
        id: nextRuleId(),
        place: "dm",
        where: { ...where, groups: "off", conversations: "" },
        edited: true,
      },
      {
        ...base,
        id: nextRuleId(),
        place: "groups",
        where: { ...where, dm: "off", dmMembers: [], dmTeams: [], dmIdentities: "" },
        edited: true,
      },
    ];
  }
  return [{ ...base, id: nextRuleId(), place: dm ? "dm" : "groups", where, edited: false }];
}

function storedWho(who: ChannelConfigurationRecord): AudienceRuleDraft["who"] {
  const roles = new Set(stringList(who["roles"]));
  return {
    roles: HUB_AUDIENCE_ROLES.filter((role) => roles.has(role)),
    teams: stringList(who["teams"]),
    members: stringList(who["members"]),
    anyone: who["anyone"] === true,
    identities: stringList(who["identities"]).join(", "),
  };
}

function storedWhere(where: ChannelConfigurationRecord): AudienceRuleDraft["where"] {
  const dmMembers = stringList(where["dmMembers"]);
  const dmTeams = stringList(where["dmTeams"]);
  const dmIdentities = stringList(where["dmIdentities"]);
  const conversations = stringList(where["conversations"]);
  const groups = audienceGroups(where["groups"]);
  let dm: AudienceDmScope = "off";
  if (where["dm"] === true) dm = "all";
  else if (dmMembers.length + dmTeams.length + dmIdentities.length > 0) dm = "specific";
  return {
    dm,
    dmMembers,
    dmTeams,
    dmIdentities: dmIdentities.join(", "),
    // A stored filter keeps its conversations beside it (`extraConversations`).
    groups: groups === "off" && conversations.length > 0 ? "specific" : groups,
    conversations: conversations.join(", "),
  };
}

function storedConditions(stored: ChannelConfigurationRecord): RuleConditionsDraft {
  const interaction = recordValue(stored["interaction"]) ?? {};
  const followUp = recordValue(interaction["followUp"]) ?? {};
  const mode = followUp["mode"];
  const ttl = followUp["ttlMinutes"];
  const contains = stored["contains"];
  return {
    ...(typeof interaction["requireMention"] === "boolean"
      ? { requireMention: interaction["requireMention"] }
      : {}),
    ...(mode === "auto" || mode === "mention-only" ? { followUpMode: mode } : {}),
    ...(typeof ttl === "number" ? { ttlMinutes: String(ttl) } : {}),
    ...(typeof contains === "string" && contains.length > 0 ? { contains } : {}),
  };
}

// --- Drafts → stored shape --------------------------------------------------------

/**
 * What a Rule saves as. Untouched, exactly what was stored; edited, the stored
 * Rule with only the leaves this editor owns replaced, so a key it does not
 * show survives.
 */
export function audienceRuleFromDraft(draft: AudienceRuleDraft): HubAudienceRule {
  if (!draft.edited && draft.stored !== undefined) return draft.stored as HubAudienceRule;
  const {
    who: _who,
    where: _where,
    interaction,
    contains: _contains,
    limits: _limits,
    ...kept
  } = draft.stored ?? EMPTY_STORED;
  const keptInteraction = { ...recordValue(interaction) };
  delete keptInteraction["requireMention"];
  delete keptInteraction["followUp"];
  const ownInteraction = { ...keptInteraction, ...interactionFromDraft(draft.conditions) };
  const contains = draft.conditions.contains?.trim() ?? "";
  return {
    ...kept,
    who: whoFromDraft(draft.who),
    where: whereFromDraft(draft.where),
    ...(Object.keys(ownInteraction).length === 0 ? {} : { interaction: ownInteraction }),
    ...(contains.length === 0 ? {} : { contains }),
    ...ownLimits(draft.limits),
  } as HubAudienceRule;
}

/** The leaves the Rule sets; a Rule at every default writes no `limits`. */
function ownLimits(draft: ChannelLimitsDraft): { limits?: ChannelLimits } {
  const parsed = parseChannelLimitsDraft(draft, RULE_LIMIT_NAMES);
  if (!parsed.valid || Object.keys(parsed.value).length === 0) return {};
  return { limits: parsed.value };
}

function whoFromDraft(who: AudienceRuleDraft["who"]): HubAudienceRule["who"] {
  // Anyone covers every sender, so a rule saved as Anyone carries nothing else.
  if (who.anyone) return { roles: [], teams: [], members: [], anyone: true, identities: [] };
  return {
    roles: who.roles,
    teams: who.teams,
    members: who.members,
    anyone: false,
    identities: splitConversationIds(who.identities),
  };
}

/** What the form's Where saves as. Conversations ride along while group chats are on. */
function whereFromDraft(where: AudienceRuleDraft["where"]): HubAudienceRule["where"] {
  return {
    dm: where.dm === "all",
    dmMembers: where.dm === "specific" ? where.dmMembers : [],
    dmTeams: where.dm === "specific" ? where.dmTeams : [],
    dmIdentities: where.dm === "specific" ? splitConversationIds(where.dmIdentities) : [],
    groups: where.groups === "specific" ? "off" : where.groups,
    conversations: where.groups === "off" ? [] : splitConversationIds(where.conversations),
  };
}

function interactionFromDraft(conditions: RuleConditionsDraft): ChannelConfigurationRecord {
  const ttl = parseTtlMinutes(conditions.ttlMinutes);
  const followUp = {
    ...(conditions.followUpMode === undefined ? {} : { mode: conditions.followUpMode }),
    ...(ttl === null ? {} : { ttlMinutes: ttl }),
  };
  return {
    ...(conditions.requireMention === undefined
      ? {}
      : { requireMention: conditions.requireMention }),
    ...(Object.keys(followUp).length === 0 ? {} : { followUp }),
  };
}

function parseTtlMinutes(text: string | undefined): number | null {
  return text === undefined ? null : parseChannelFollowUpTtlMinutes(text);
}

/** The conditions a Rule meets: its own, over what it inherits. */
export function effectiveConditions(
  conditions: RuleConditionsDraft,
  inherited: InheritedConditions,
): InheritedConditions & { contains?: string } {
  const ttl = parseTtlMinutes(conditions.ttlMinutes);
  return {
    requireMention: conditions.requireMention ?? inherited.requireMention,
    followUpMode: conditions.followUpMode ?? inherited.followUpMode,
    ttlMinutes: ttl ?? inherited.ttlMinutes,
    ...(conditions.contains === undefined ? {} : { contains: conditions.contains }),
  };
}

/**
 * Conversations stored beside All / Public only / Private only by an earlier editor, which
 * offered both at once. They still count until the configurator picks an option again.
 */
export function extraConversations(where: AudienceRuleDraft["where"]): string[] {
  return where.groups === "off" || where.groups === "specific"
    ? []
    : splitConversationIds(where.conversations);
}

// --- Checks ----------------------------------------------------------------------

function hasWhoPart(who: AudienceRuleDraft["who"]): boolean {
  return (
    who.anyone ||
    who.roles.length > 0 ||
    who.teams.length > 0 ||
    who.members.length > 0 ||
    splitConversationIds(who.identities).length > 0
  );
}

/** Why a Rule cannot save yet, or null. `inherited` decides which condition fields show. */
export function audienceRuleProblem(
  rule: AudienceRuleDraft,
  inherited: InheritedConditions,
): string | null {
  return ruleProblemAt(rule, inherited)?.message ?? null;
}

/** Which part of the Rule a problem belongs to, so it shows under that field. */
export type RuleProblemPart = "where" | "who" | "conditions";

/** Why a Rule cannot save yet, and the part to show it under; null when it can. */
export function ruleProblemAt(
  rule: AudienceRuleDraft,
  inherited: InheritedConditions,
): { part: RuleProblemPart; message: string } | null {
  const whoOrWhere = whoOrWhereProblem(rule);
  if (whoOrWhere !== null) return whoOrWhere;
  const message = conditionsProblem(rule, inherited) ?? legacyDmProblem(rule);
  return message === null ? null : { part: "conditions", message };
}

function whoOrWhereProblem(
  rule: AudienceRuleDraft,
): { part: RuleProblemPart; message: string } | null {
  const { who, where } = rule;
  if (rule.place === "groups") {
    if (where.groups === "off") return { part: "where", message: "Choose which chats." };
    if (where.groups === "specific" && splitConversationIds(where.conversations).length === 0) {
      return { part: "where", message: "Pick a chat, or choose Every chat the bot is in." };
    }
  }
  return hasWhoPart(who) ? null : { part: "who", message: "Pick at least one person." };
}

function conditionsProblem(rule: AudienceRuleDraft, inherited: InheritedConditions): string | null {
  const { conditions } = rule;
  // Only a minutes field that shows can block the save: its mode may be inherited.
  const effective = effectiveConditions(conditions, inherited);
  if (
    effective.requireMention &&
    effective.followUpMode === "auto" &&
    conditions.ttlMinutes !== undefined &&
    parseTtlMinutes(conditions.ttlMinutes) === null
  ) {
    return "Use a whole number of minutes.";
  }
  if (conditions.contains !== undefined && conditions.contains.trim().length === 0) {
    return "Type the text a message must contain.";
  }
  const limits = parseChannelLimitsDraft(rule.limits, RULE_LIMIT_NAMES);
  return limits.valid ? null : limits.error;
}

/** A stored Rule that narrowed DMs: a list the Who can never reach lets nobody in. */
function legacyDmProblem({ who, where }: AudienceRuleDraft): string | null {
  if (where.dm !== "specific" || who.anyone) return null;
  const dmPeople = where.dmMembers.length + where.dmTeams.length;
  const whoNamesMembers = who.roles.length > 0 || who.teams.length > 0 || who.members.length > 0;
  if (dmPeople > 0 && !whoNamesMembers) {
    return "This older Rule limits DMs to Members its Who does not name. Pick the people again.";
  }
  if (splitConversationIds(where.dmIdentities).length > 0 && who.identities.trim().length === 0) {
    return "This older Rule limits DMs to Guests its Who does not name. Pick the people again.";
  }
  return null;
}

/** A Route needs one Rule, and every Rule must be able to save. */
export function audienceRulesComplete(
  rules: readonly AudienceRuleDraft[],
  inherited: InheritedConditions,
): boolean {
  return rules.length > 0 && rules.every((rule) => audienceRuleProblem(rule, inherited) === null);
}

export function isOpenAudienceDraft(rules: readonly AudienceRuleDraft[]): boolean {
  // Anyone narrowed to named DM senders admits those senders alone (the Hub's `isOpenAudience`).
  return rules.some(({ who, where }) => {
    const saved = whereFromDraft(where);
    return (
      who.anyone &&
      (saved.dm === true || saved.groups !== "off" || (saved.conversations ?? []).length > 0)
    );
  });
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
 * The public/private choices are offered only there: elsewhere they match
 * nothing (`packages/hub/src/channels/config/audience.ts` is the runtime side).
 */
export const VISIBILITY_CAPABILITY = "visibility";

export function channelReportsVisibility(
  entry: { capabilities: readonly string[] } | undefined,
): boolean {
  return entry?.capabilities.includes(VISIBILITY_CAPABILITY) === true;
}

/** A public-only or private-only filter on a channel that never reports
 * visibility: that Rule matches no group chat. */
export function visibilityFilterMatchesNothing(
  where: AudienceRuleDraft["where"],
  reportsVisibility: boolean,
): boolean {
  return !reportsVisibility && (where.groups === "public" || where.groups === "private");
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
