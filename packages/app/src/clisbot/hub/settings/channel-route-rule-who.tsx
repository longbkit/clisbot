// Who a Rule lets in: one choice from narrow to wide, each naming the people
// it covers (docs/audits/2026-10-05-routes-and-rules.md). Roles nest on the
// Hub, so they are rungs of one ladder; anything else is "Only people I pick".

import React, { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import {
  WHO_CHOICE_LABELS,
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

export const OPEN_AUDIENCE_WARNING = {
  title: "Anyone in the matching conversations can use this Route",
  description:
    "They can talk to the Agent this Route runs, with the settings below. This does not give them Clisbot, Host or Project access. They meet the limits under this rule, which start from safe defaults.",
};

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
          rule.place === "dm"
            ? "Who can message the bot privately?"
            : "Who can talk to the bot there?"
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
      {choice === "anyone" ? (
        <Alert
          variant="warning"
          title={OPEN_AUDIENCE_WARNING.title}
          description={OPEN_AUDIENCE_WARNING.description}
        />
      ) : null}
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
        title={`Only ${ruleWhoLabel(rule, names)}`}
        description="Saved by an older version, which let them in only if they also matched the people chosen before. It is kept as it is until you edit it."
      />
      <View style={styles.action}>
        <Button size="sm" variant="outline" disabled={disabled} onPress={edit}>
          Edit these people
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
  return useMemo(() => {
    const everyone = people.people;
    const linked = everyone.filter((person) => person.linked === true).length;
    const known = everyone.some((person) => person.linked !== undefined);
    return [
      {
        value: "owners",
        label: WHO_CHOICE_LABELS.owners,
        description: namesLine(peopleWithRole(everyone, "owner"), place.channelName),
      },
      {
        value: "admins",
        label: WHO_CHOICE_LABELS.admins,
        description: namesLine(peopleWithRole(everyone, "admin"), place.channelName),
      },
      {
        value: "everyone",
        label: WHO_CHOICE_LABELS.everyone,
        description: `${String(everyone.length)} ${everyone.length === 1 ? "person" : "people"}${
          known ? ` · ${String(linked)} linked on ${place.channelName}` : ""
        }`,
      },
      { value: "pick", label: WHO_CHOICE_LABELS.pick },
      rule.place === "dm"
        ? {
            value: "anyone",
            label: `Anyone on ${place.channelName}`,
            description: "Including people outside your Hub",
          }
        : {
            value: "anyone",
            label: "Anyone in the chat",
            description: "Including people outside your Hub",
          },
    ];
  }, [people.people, place.channelName, rule.place]);
}

/** "Long Luong, An Nguyễn (not linked on Slack) and 2 others". */
function namesLine(people: readonly RulePerson[], channelName: string): string | undefined {
  if (people.length === 0) return undefined;
  const named = people
    .slice(0, SHOWN_NAMES)
    .map((person) =>
      person.linked === false ? `${person.name} (not linked on ${channelName})` : person.name,
    );
  const others = people.length - named.length;
  return others > 0 ? `${named.join(", ")} and ${String(others)} others` : named.join(", ");
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
  const self = unlinkedSelf(people);
  if (self === undefined || people.connection === undefined || !ruleLetsIn(rule, self)) return null;
  const why = `The bot can't recognize you on ${channelName} yet, so this rule does not let you in.`;
  if (!people.listening) {
    // A `/link` sent now would reach no running bot and nothing would answer it.
    return (
      <Alert
        variant="info"
        title={why}
        description={`The bot starts on ${channelName} when you save this Route. Then link your account from the Connection's card on the Connections page.`}
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
