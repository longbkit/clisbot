// The people a Rule can name, and which of them the bot can recognize: a Hub
// Member is recognized on a channel only through a linked channel identity
// (docs/audits/2026-10-05-routes-and-rules.md, "Linked identities"). An owner
// of a Hub with no sign-in still has to link theirs, or "Only owners" lets
// nobody in.

import { useMemo } from "react";
import { useHubAccount } from "../account-provider";
import { identityCoversConnection, useChannelIdentityReads } from "../channel-identity-directory";
import type { HubConnection } from "./channel-identity-link-realms";
import type { AudienceRuleDraft } from "./channel-route-audience";
import type { AudienceOption } from "./channel-route-audience-controls";

export type HubRole = "owner" | "admin" | "member";

export interface RulePerson {
  /** Membership id. */
  id: string;
  name: string;
  role: HubRole;
  /** Linked on this Connection's channel; undefined when this viewer cannot see it. */
  linked: boolean | undefined;
}

export interface RulePeople {
  people: readonly RulePerson[];
  teams: readonly AudienceOption[];
  /** The Member editing the Route. */
  selfId: string | null;
  /** The Connection the Route belongs to; absent while none is picked. */
  connection: HubConnection | undefined;
  /** The bot runs on this Connection, so a `/link` sent to it lands now. A
   * Connection the form is adding starts running only once the Route is saved. */
  listening: boolean;
  /** Polls the links while the editor waits for one to land. */
  refresh(): void;
}

/** People and Teams, with whether each Member is linked where this Connection runs. */
export function useRulePeople(input: {
  connection: HubConnection | undefined;
  teams: readonly AudienceOption[];
  /** Poll the links while a link code is out. */
  watchLinks: boolean;
  listening: boolean;
}): RulePeople {
  const hub = useHubAccount();
  const members = hub.signedIn?.team?.members;
  const selfId = hub.signedIn?.membership.id ?? null;
  // An Organization Admin reads every Member's links; anyone else, only their own.
  const seesEveryone = hub.signedIn?.capabilities.manageResources === true;
  const { identities } = useChannelIdentityReads({
    enabled: input.connection !== undefined,
    refetchIntervalMs: input.watchLinks ? 3_000 : false,
  });
  const { connection, teams, listening } = input;
  const linkedIds = useMemo(() => {
    if (connection === undefined || identities.data === undefined) return undefined;
    return new Set(
      identities.data.identities
        .filter((identity) => identityCoversConnection(identity, connection))
        .map(({ memberId }) => memberId),
    );
  }, [connection, identities.data]);
  const people = useMemo<RulePerson[]>(
    () =>
      (members ?? []).map((member) => ({
        id: member.id,
        name: member.name,
        role: member.role,
        linked:
          linkedIds === undefined || (!seesEveryone && member.id !== selfId)
            ? undefined
            : linkedIds.has(member.id),
      })),
    [linkedIds, members, seesEveryone, selfId],
  );
  const refetch = identities.refetch;
  return useMemo(
    () => ({ people, teams, selfId, connection, listening, refresh: () => void refetch() }),
    [connection, listening, people, refetch, selfId, teams],
  );
}

/**
 * Whether a Rule's Who names this Member as a Member: the only way in that
 * needs their linked identity (Anyone needs no link). Teams are not checked:
 * the app does not read Team membership here.
 */
export function ruleLetsIn(rule: Pick<AudienceRuleDraft, "who">, person: RulePerson): boolean {
  const { who } = rule;
  if (who.anyone) return false;
  if (who.members.includes(person.id)) return true;
  return who.roles.some((role) => peopleWithRole([person], role).length > 0);
}

/** The Member using the app, when the bot on this Connection cannot recognize them yet. */
export function unlinkedSelf(people: RulePeople): RulePerson | undefined {
  const self = people.people.find((person) => person.id === people.selfId);
  return self?.linked === false && people.connection !== undefined ? self : undefined;
}

/** The Members a role lets in: `admin` includes Owners, `member` is everyone. */
export function peopleWithRole(people: readonly RulePerson[], role: HubRole): RulePerson[] {
  if (role === "member") return [...people];
  if (role === "admin") return people.filter((person) => person.role !== "member");
  return people.filter((person) => person.role === "owner");
}
