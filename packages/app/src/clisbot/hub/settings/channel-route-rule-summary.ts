// One line per Rule, as the folded Rule, the Connections list, the Automation
// editor and Access show it: "#support, #ops · Everyone on the Hub · when
// mentioned". Pure; names come from the caller (`AudienceNames`).

import { i18n } from "@/i18n/i18next";
import { splitConversationIds } from "../conversation-picker";
import { RULE_LIMIT_NAMES, limitsAuthored } from "./channel-limits-draft";
import {
  audienceRoleLabel,
  whoChoiceLabel,
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

/** A group-chat scope that names every chat of a kind. */
export function groupScopeLabel(groups: Exclude<AudienceGroups, "off">): string {
  if (groups === "all") return i18n.t("hub.routes.groupScopes.all");
  if (groups === "public") return i18n.t("hub.routes.groupScopes.public");
  return i18n.t("hub.routes.groupScopes.private");
}

/** The people a Rule lets in: its choice, or the people picked by name. */
export function ruleWhoLabel(rule: AudienceRuleDraft, names: AudienceNames): string {
  const choice = whoChoiceOf(rule);
  if (choice === "anyone")
    return rule.place === "dm"
      ? i18n.t("hub.routes.summary.anyone")
      : i18n.t("hub.routes.summary.anyoneInChat");
  if (choice !== "pick") return whoChoiceLabel(choice);
  const { who, where } = rule;
  // A stored Rule that narrowed DMs lets in only the people it named there.
  const narrowed = where.dm === "specific";
  const parts = [
    ...(narrowed ? [] : who.roles.map((role) => audienceRoleLabel(role))),
    ...(narrowed ? where.dmTeams : who.teams).map((id) =>
      i18n.t("hub.routes.summary.team", { name: names.teamName(id) }),
    ),
    ...(narrowed ? where.dmMembers : who.members).map((id) => names.memberName(id)),
    ...splitConversationIds(narrowed ? where.dmIdentities : who.identities).map((identity) =>
      i18n.t("hub.routes.summary.guest", { identity }),
    ),
  ];
  return parts.length === 0 ? i18n.t("hub.routes.summary.nobody") : joinNatural(parts);
}

/** Where a Rule applies. */
export function rulePlaceLabel(rule: AudienceRuleDraft, names: AudienceNames): string {
  if (rule.place === "dm") return i18n.t("hub.routes.summary.dms");
  const { groups, conversations } = rule.where;
  if (groups === "all" || groups === "public" || groups === "private")
    return groupScopeLabel(groups);
  const chats = splitConversationIds(conversations).map((id) => names.conversationLabel(id));
  return chats.length === 0
    ? i18n.t("hub.routes.summary.noChats")
    : chats.join(i18n.t("hub.routes.common.listSeparator"));
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
        ? i18n.t("hub.routes.summary.whenMentionedFollowUp", {
            minutes: String(effective.ttlMinutes),
          })
        : i18n.t("hub.routes.summary.whenMentioned"),
    );
  }
  if (effective.contains !== undefined && effective.contains.trim().length > 0) {
    parts.push(i18n.t("hub.routes.summary.contains", { text: effective.contains.trim() }));
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
    ...(limitsAuthored(rule.limits, RULE_LIMIT_NAMES)
      ? [i18n.t("hub.routes.summary.customLimits")]
      : []),
  ].join(" · ");
}

/** "A, B and C" in the reader's language. */
function joinNatural(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return i18n.t("hub.routes.common.listLast", {
    rest: parts.slice(0, -1).join(i18n.t("hub.routes.common.listSeparator")),
    last: parts[parts.length - 1],
  });
}
