// Who a Rule lets in: one choice from narrow to wide, each naming the people
// it covers (docs/audits/2026-10-05-routes-and-rules.md). Roles nest on the
// Hub, so they are rungs of one ladder; anything else is "Only people I pick".

import type { TFunction } from "i18next";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { i18n } from "@/i18n/i18next";
import { settingsStyles } from "@/styles/settings";
import {
  whoChoiceLabel,
  whoChoiceOf,
  whoForChoice,
  type AudienceRuleDraft,
  type WhoChoice,
} from "./channel-route-audience";
import { RadioList, type RadioOption } from "./channel-route-audience-controls";
import { PeoplePicker, type PeoplePickerPlace } from "./channel-route-audience-people";
import { LinkMyAccount } from "./channel-route-rule-link";
import {
  peopleWithRole,
  ruleLetsIn,
  unlinkedSelf,
  type RulePeople,
  type RulePerson,
} from "./channel-route-rule-people";
import { ruleWhoLabel, type AudienceNames } from "./channel-route-rule-summary";

/** The warning an open Rule carries, in the reader's language. */
export function openAudienceWarning(): { title: string; description: string } {
  return {
    title: i18n.t("hub.routes.who.openTitle"),
    description: i18n.t("hub.routes.who.openDescription"),
  };
}

const SHOWN_NAMES = 3;

export function RuleWhoFields({
  rule,
  people,
  place,
  names,
  disabled,
  update,
  problem,
}: {
  rule: AudienceRuleDraft;
  people: RulePeople;
  place: PeoplePickerPlace;
  names: AudienceNames;
  disabled: boolean;
  update(change: (rule: AudienceRuleDraft) => AudienceRuleDraft): void;
  /** Why the Who cannot save yet, shown under the people picker. */
  problem: string | null;
}) {
  const { t } = useTranslation();
  const choice = whoChoiceOf(rule);
  const options = useWhoOptions(rule, people, place);
  const choose = useCallback(
    (next: WhoChoice) => {
      // Pressing the choice already made changes nothing, so it never edits a stored Rule.
      if (next === choice) return;
      update((current) => ({
        ...current,
        // A pick starts empty: the rung it leaves is not a person picked.
        who: next === "pick" ? NOBODY : whoForChoice(next),
        picking: next === "pick",
        where: withoutNarrowing(current.where),
      }));
    },
    [choice, update],
  );
  const pick = useCallback(
    (who: AudienceRuleDraft["who"]) =>
      update((current) => ({
        ...current,
        who,
        picking: true,
        where: withoutNarrowing(current.where),
      })),
    [update],
  );
  return (
    <>
      <RadioList
        label={
          rule.place === "dm" ? t("hub.routes.who.dmQuestion") : t("hub.routes.who.groupQuestion")
        }
        options={options}
        selected={choice}
        onChange={choose}
        disabled={disabled}
      />
      {rule.where.dm === "specific" ? (
        <NarrowedDmNote rule={rule} names={names} update={update} disabled={disabled} />
      ) : null}
      {choice === "pick" && rule.where.dm !== "specific" ? (
        <PeoplePicker
          who={rule.who}
          people={people}
          place={place}
          onChange={pick}
          disabled={disabled}
        />
      ) : null}
      {problem === null ? null : <Text style={settingsStyles.rowError}>{problem}</Text>}
      {choice === "anyone" ? <Alert variant="warning" {...openAudienceWarning()} /> : null}
      <SelfLinkPrompt rule={rule} people={people} channelName={place.channelName} />
    </>
  );
}

/**
 * A stored Rule that narrowed DMs to named people keeps its meaning until
 * edited; editing starts the picker from exactly those people.
 */
function NarrowedDmNote({
  rule,
  names,
  update,
  disabled,
}: {
  rule: AudienceRuleDraft;
  names: AudienceNames;
  update(change: (rule: AudienceRuleDraft) => AudienceRuleDraft): void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const edit = useCallback(
    () =>
      update((current) => ({
        ...current,
        who: narrowedPeople(current),
        picking: true,
        where: withoutNarrowing(current.where),
      })),
    [update],
  );
  return (
    <View style={styles.note}>
      <Alert
        variant="info"
        title={t("hub.routes.who.narrowedTitle", { who: ruleWhoLabel(rule, names) })}
        description={t("hub.routes.who.narrowedDescription")}
      />
      <View style={styles.action}>
        <Button size="sm" variant="outline" disabled={disabled} onPress={edit}>
          {t("hub.routes.who.editPeople")}
        </Button>
      </View>
    </View>
  );
}

const NOBODY: AudienceRuleDraft["who"] = {
  roles: [],
  teams: [],
  members: [],
  anyone: false,
  identities: "",
};

/** An older Rule that narrowed DMs, edited: exactly the people it named there, never more. */
function narrowedPeople({ where }: AudienceRuleDraft): AudienceRuleDraft["who"] {
  return {
    roles: [],
    teams: where.dmTeams,
    members: where.dmMembers,
    anyone: false,
    identities: where.dmIdentities,
  };
}

/** Choosing who again drops the older DM narrowing: the choice is the whole Who now. */
function withoutNarrowing(where: AudienceRuleDraft["where"]): AudienceRuleDraft["where"] {
  return where.dm === "specific"
    ? { ...where, dm: "all", dmMembers: [], dmTeams: [], dmIdentities: "" }
    : where;
}

function useWhoOptions(
  rule: AudienceRuleDraft,
  people: RulePeople,
  place: PeoplePickerPlace,
): RadioOption<WhoChoice>[] {
  const { t } = useTranslation();
  return useMemo(() => {
    const everyone = people.people;
    const channel = place.channelName;
    const outsideHub = t("hub.routes.who.outsideHub");
    return [
      {
        value: "owners",
        label: whoChoiceLabel("owners"),
        description: namesLine(t, peopleWithRole(everyone, "owner"), channel),
      },
      {
        value: "admins",
        label: whoChoiceLabel("admins"),
        description: namesLine(t, peopleWithRole(everyone, "admin"), channel),
      },
      {
        value: "everyone",
        label: whoChoiceLabel("everyone"),
        description: everyoneLine(t, everyone, channel),
      },
      { value: "pick", label: whoChoiceLabel("pick") },
      rule.place === "dm"
        ? {
            value: "anyone",
            label: t("hub.routes.who.anyoneOn", { channel }),
            description: outsideHub,
          }
        : { value: "anyone", label: t("hub.routes.summary.anyoneInChat"), description: outsideHub },
    ];
  }, [people.people, place.channelName, rule.place, t]);
}

/** "12 people · 9 linked on Slack", the link count once this viewer can see it. */
function everyoneLine(t: TFunction, everyone: readonly RulePerson[], channel: string): string {
  const count = everyone.length;
  if (!everyone.some((person) => person.linked !== undefined))
    return t("hub.routes.who.people", { count });
  const linked = String(everyone.filter((person) => person.linked === true).length);
  return t("hub.routes.who.peopleLinked", { count, linked, channel });
}

/** "Long Luong, An Nguyễn (not linked on Slack) and 2 others". */
function namesLine(
  t: TFunction,
  people: readonly RulePerson[],
  channelName: string,
): string | undefined {
  if (people.length === 0) return undefined;
  const named = people
    .slice(0, SHOWN_NAMES)
    .map((person) =>
      person.linked === false
        ? t("hub.routes.who.notLinkedName", { name: person.name, channel: channelName })
        : person.name,
    );
  const others = people.length - named.length;
  if (others > 0) {
    const names = named.join(t("hub.routes.common.listSeparator"));
    return t("hub.routes.who.namesAndOthers", { names, count: others });
  }
  return named.join(t("hub.routes.common.listSeparator"));
}

/**
 * The person editing is one of the people this Rule lets in but the bot cannot
 * recognize them yet: offer the link here, since only they can make it.
 */
function SelfLinkPrompt({
  rule,
  people,
  channelName,
}: {
  rule: AudienceRuleDraft;
  people: RulePeople;
  channelName: string;
}) {
  const { t } = useTranslation();
  const self = unlinkedSelf(people);
  if (self === undefined || people.connection === undefined || !ruleLetsIn(rule, self)) return null;
  const why = t("hub.routes.who.selfUnlinked", { channel: channelName });
  if (!people.listening) {
    // A `/link` sent now would reach no running bot and nothing would answer it.
    return (
      <Alert
        variant="info"
        title={why}
        description={t("hub.routes.who.linkAfterSave", { channel: channelName })}
      />
    );
  }
  return (
    <LinkMyAccount connection={people.connection} channelName={channelName} people={people}>
      <Text style={settingsStyles.rowHint}>{why}</Text>
    </LinkMyAccount>
  );
}

const styles = StyleSheet.create((theme) => ({
  note: { gap: theme.spacing[2] },
  action: { alignItems: "flex-start" },
}));
