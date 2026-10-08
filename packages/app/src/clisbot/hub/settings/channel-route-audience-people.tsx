// "Only people I pick": one list for everyone a Rule can name — Hub roles,
// Teams, Hub people, and people from the channel who have no Hub account (by
// their channel user id). The person configuring picks people; which kind of
// subject each is stays the Hub's business.

import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { SelectFieldOption } from "@/components/ui/select-field";
import { splitConversationIds } from "../conversation-picker";
import type { HubAudienceRole } from "../contracts";
import { audienceRoleLabel, type AudienceRuleDraft } from "./channel-route-audience";
import { useObservedSenders } from "./conversation-picker-field";
import { MultiSelectField, type MultiSelection } from "./multi-select-field";
import type { RulePeople } from "./channel-route-rule-people";

const ROLE = "role:";
const TEAM = "team:";
const MEMBER = "member:";
const GUEST = "guest:";
const ROLES: readonly HubAudienceRole[] = ["owner", "admin", "member"];

export interface PeoplePickerPlace {
  /** The channel's name, as people know it ("Slack"). */
  channelName: string;
  observedChannel: string | null;
  accountId: string | null;
}

export function PeoplePicker({
  who,
  people,
  place,
  onChange,
  disabled,
}: {
  who: AudienceRuleDraft["who"];
  people: RulePeople;
  place: PeoplePickerPlace;
  onChange(who: AudienceRuleDraft["who"]): void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const senders = useObservedSenders(place.observedChannel, place.accountId);
  const identities = useMemo(() => splitConversationIds(who.identities), [who.identities]);
  const options = useMemo<SelectFieldOption<string>[]>(() => {
    const observed = (senders.data?.senders ?? []).map((sender) => ({
      id: sender.identity,
      label: sender.name ?? sender.username ?? sender.id,
      description: sender.username ? `@${sender.username}` : sender.id,
    }));
    // A picked id the bot has not seen yet still lists, under the id itself.
    const unseen = identities
      .filter((id) => !observed.some((sender) => sender.id === id))
      .map((id) => ({ id, label: id, description: "" }));
    const channel = place.channelName;
    const notLinked = t("hub.routes.people.notLinked", { channel });
    const fromChannel = t("hub.routes.people.fromChannel", { channel });
    return [
      ...ROLES.map((role) =>
        option(ROLE, role, audienceRoleLabel(role), t("hub.routes.people.roles")),
      ),
      ...people.teams.map((team) => option(TEAM, team.id, team.name, t("hub.routes.people.teams"))),
      ...people.people.map((person) =>
        option(
          MEMBER,
          person.id,
          person.name,
          t("hub.routes.people.hubPeople"),
          person.linked === false ? notLinked : undefined,
        ),
      ),
      ...[...observed, ...unseen].map((sender) =>
        option(GUEST, sender.id, sender.label, fromChannel, sender.description),
      ),
    ];
  }, [identities, people.people, people.teams, place, senders.data?.senders, t]);
  const value = useMemo(
    () => [
      ...who.roles.map((id) => `${ROLE}${id}`),
      ...who.teams.map((id) => `${TEAM}${id}`),
      ...who.members.map((id) => `${MEMBER}${id}`),
      ...identities.map((id) => `${GUEST}${id}`),
    ],
    [identities, who.members, who.roles, who.teams],
  );
  const change = useCallback(
    (picked: MultiSelection) => {
      // No `allLabel` is offered, so the wildcard never arrives.
      if (picked === "*") return;
      onChange(whoFromPicked(picked));
    },
    [onChange],
  );
  const create = useMemo(
    () => ({
      label: t("hub.routes.people.addUserId", { channel: place.channelName }),
      description: t("hub.routes.people.addUserIdDescription"),
      onCreate: (text: string) => onChange(whoFromPicked([...value, `${GUEST}${text.trim()}`])),
    }),
    [onChange, place.channelName, t, value],
  );
  return (
    <MultiSelectField
      label={t("hub.routes.people.label")}
      options={options}
      value={value}
      onChange={change}
      disabled={disabled}
      placeholder={t("hub.routes.people.placeholder")}
      searchPlaceholder={t("hub.routes.people.searchPlaceholder")}
      create={create}
    />
  );
}

function option(
  prefix: string,
  id: string,
  label: string,
  group: string,
  description?: string,
): SelectFieldOption<string> {
  const value = `${prefix}${id}`;
  return { id: value, value, label, group, ...(description ? { description } : {}) };
}

function whoFromPicked(picked: readonly string[]): AudienceRuleDraft["who"] {
  const ids = (prefix: string) =>
    picked.filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length));
  return {
    roles: ROLES.filter((role) => ids(ROLE).includes(role)),
    teams: ids(TEAM),
    members: ids(MEMBER),
    anyone: false,
    identities: ids(GUEST).join(", "),
  };
}
