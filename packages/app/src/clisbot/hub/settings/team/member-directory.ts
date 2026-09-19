import { identityCoversConnection } from "../../channel-identity-directory";
import type { IdentityRealm } from "../channel-identity-link-realms";
import type { FilterChip } from "../filter-chips";
import { matchesSearch } from "../search-text";
import { needsTeam } from "./team-membership";
import type { HubIdentity, HubMember, HubTeam } from "./types";

export type MemberFilter = "all" | "owners" | "admins" | "noTeam" | "noChat";

/** One identity realm and whether the Member is recognized there. */
export interface RealmLink {
  key: string;
  label: string;
  linked: boolean;
}

export interface MemberDirectoryRow {
  member: HubMember;
  teams: HubTeam[];
  /** Undefined for viewers who only see their own Channel identities. */
  chat: RealmLink[] | undefined;
}

export function memberDirectoryRows(
  members: readonly HubMember[] = [],
  teams: readonly HubTeam[] = [],
  identities: readonly HubIdentity[] | undefined,
  realms: readonly IdentityRealm[] = [],
): MemberDirectoryRow[] {
  return members.map((member) => ({
    member,
    teams: teams.filter(({ userIds }) => userIds.includes(member.userId)),
    chat: identities === undefined ? undefined : memberRealmLinks(member, identities, realms),
  }));
}

export function memberRealmLinks(
  member: Pick<HubMember, "id">,
  identities: readonly HubIdentity[],
  realms: readonly IdentityRealm[],
): RealmLink[] {
  const own = identities.filter(({ memberId }) => memberId === member.id);
  return realms.map((realm) => ({
    key: realm.key,
    label: realm.label,
    linked: own.some((identity) =>
      realm.connections.some((connection) => identityCoversConnection(identity, connection)),
    ),
  }));
}

function matchesFilter(row: MemberDirectoryRow, filter: MemberFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "owners":
      return row.member.role === "owner";
    case "admins":
      return row.member.role === "admin";
    case "noTeam":
      return needsTeam(row.member, row.teams);
    case "noChat":
      return row.chat !== undefined && !row.chat.some(({ linked }) => linked);
  }
}

/** The Members overview: every count is a filter. "No chat account" needs the organization's identities. */
export function memberChips(rows: readonly MemberDirectoryRow[]): FilterChip<MemberFilter>[] {
  const count = (filter: MemberFilter) => rows.filter((row) => matchesFilter(row, filter)).length;
  const chatVisible = rows.some(({ chat }) => chat !== undefined && chat.length > 0);
  return [
    { value: "all", label: "Members", count: rows.length },
    { value: "owners", label: "Owners", count: count("owners") },
    { value: "admins", label: "Admins", count: count("admins") },
    { value: "noTeam", label: "No Team", count: count("noTeam") },
    ...(chatVisible
      ? [{ value: "noChat" as const, label: "No chat account", count: count("noChat") }]
      : []),
  ];
}

export function filterMemberRows(
  rows: readonly MemberDirectoryRow[],
  query: string,
  filter: MemberFilter,
): MemberDirectoryRow[] {
  return rows.filter(
    (row) =>
      matchesFilter(row, filter) &&
      matchesSearch(query, [
        row.member.name,
        row.member.email,
        ...row.teams.map(({ name }) => name),
      ]),
  );
}

export function memberTeamNames(member: HubMember, teams: readonly HubTeam[]): string {
  if (teams.length > 0) return teams.map(({ name }) => name).join(", ");
  return member.role === "owner" ? "Full access, no Team needed" : "No Team";
}
