// One line per Rule, as the folded Rule, the Connections list, the Automation
// editor and Access show it: "#support, #ops · Everyone on the Hub · when
// mentioned". Pure; names come from the caller (`AudienceNames`).

import { splitConversationIds } from "../conversation-picker";
import { RULE_LIMIT_NAMES, limitsAuthored } from "./channel-limits-draft";
import {
  AUDIENCE_ROLE_LABELS,
  WHO_CHOICE_LABELS,
  effectiveConditions,
  whoChoiceOf,
  type AudienceGroups,
  type AudienceRuleDraft,
  type InheritedConditions,
} from "./channel-route-audience";

/** Names for the ids a Rule stores; unknown ids fall back to the id itself. */
export interface AudienceNames {
  teamName(id: string): string;
  memberName(id: string): string;
  conversationLabel(id: string): string;
}

/** Ids stand in for names where nothing better is loaded. */
export const ID_NAMES: AudienceNames = {
  teamName: (id) => id,
  memberName: (id) => id,
  conversationLabel: (id) => id,
};

const GROUP_LABELS: Record<Exclude<AudienceGroups, "off">, string> = {
  all: "Every chat the bot is in",
  public: "Every public chat",
  private: "Every private chat",
};

/** The people a Rule lets in: its choice, or the people picked by name. */
export function ruleWhoLabel(rule: AudienceRuleDraft, names: AudienceNames): string {
  const choice = whoChoiceOf(rule);
  if (choice === "anyone") return rule.place === "dm" ? "Anyone" : "Anyone in the chat";
  if (choice !== "pick") return WHO_CHOICE_LABELS[choice];
  const { who, where } = rule;
  // A stored Rule that narrowed DMs lets in only the people it named there.
  const narrowed = where.dm === "specific";
  const parts = [
    ...(narrowed ? [] : who.roles.map((role) => AUDIENCE_ROLE_LABELS[role])),
    ...(narrowed ? where.dmTeams : who.teams).map((id) => `Team ${names.teamName(id)}`),
    ...(narrowed ? where.dmMembers : who.members).map((id) => names.memberName(id)),
    ...splitConversationIds(narrowed ? where.dmIdentities : who.identities).map(
      (identity) => `Guest ${identity}`,
    ),
  ];
  return parts.length === 0 ? "Nobody yet" : joinNatural(parts);
}

/** Where a Rule applies. */
export function rulePlaceLabel(rule: AudienceRuleDraft, names: AudienceNames): string {
  if (rule.place === "dm") return "DMs";
  const { groups, conversations } = rule.where;
  if (groups === "all" || groups === "public" || groups === "private") return GROUP_LABELS[groups];
  const chats = splitConversationIds(conversations).map((id) => names.conversationLabel(id));
  return chats.length === 0 ? "No chats yet" : chats.join(", ");
}

/** When a message there gets in, beyond the place and the people. */
export function ruleConditionsLabel(
  rule: AudienceRuleDraft,
  inherited: InheritedConditions,
): string[] {
  const effective = effectiveConditions(rule.conditions, inherited);
  const parts: string[] = [];
  if (effective.requireMention) {
    parts.push(
      effective.followUpMode === "auto"
        ? `when mentioned, then for ${String(effective.ttlMinutes)} min`
        : "when mentioned",
    );
  }
  if (effective.contains !== undefined && effective.contains.trim().length > 0) {
    parts.push(`“${effective.contains.trim()}”`);
  }
  return parts;
}

/** "#support · Everyone on the Hub · when mentioned · “#help”". */
export function ruleSummary(
  rule: AudienceRuleDraft,
  names: AudienceNames,
  inherited: InheritedConditions,
): string {
  return [
    rulePlaceLabel(rule, names),
    ruleWhoLabel(rule, names),
    ...ruleConditionsLabel(rule, inherited),
    ...(limitsAuthored(rule.limits, RULE_LIMIT_NAMES) ? ["custom limits"] : []),
  ].join(" · ");
}

function joinNatural(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
