import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { settingsStyles } from "@/styles/settings";
import { capitalizeLabel, countLabel } from "../labels";
import { EmptyRow, ResourceFeedbackGroup } from "../resource-rows";
import { matchesSearch } from "../search-text";
import { SummaryStats, type SummaryStat } from "../summary-stats";
import { canAddPeopleToTeams, needsTeam } from "./team-membership";
import type {
  HubAccount,
  HubIdentity,
  HubMember,
  HubTeam,
  TeamResources,
  TeamSelection,
} from "./types";

type MemberFilter = "all" | "withoutTeam" | "managers";

const MEMBER_FILTERS: SegmentedControlOption<MemberFilter>[] = [
  { value: "all", label: "All" },
  { value: "withoutTeam", label: "Without a Team" },
  { value: "managers", label: "Owners & admins" },
];

/** Rows rendered before "Show all"; a long organization should not render every row at once. */
const PAGE_SIZE = 50;

export interface MemberDirectoryRow {
  member: HubMember;
  teams: HubTeam[];
  /** Undefined for viewers who only see their own Channel identities. */
  identityCount: number | undefined;
}

export function memberDirectoryRows(
  members: readonly HubMember[] = [],
  teams: readonly HubTeam[] = [],
  identities: readonly HubIdentity[] | undefined,
): MemberDirectoryRow[] {
  return members.map((member) => ({
    member,
    teams: teams.filter(({ userIds }) => userIds.includes(member.userId)),
    identityCount: identities?.filter(({ memberId }) => memberId === member.id).length,
  }));
}

function memberStats(
  rows: MemberDirectoryRow[],
  teamCount: number,
  pendingInvitations: number | undefined,
): SummaryStat[] {
  return [
    { label: "Members", value: rows.length },
    {
      label: "Owners & admins",
      value: rows.filter(({ member }) => member.role !== "member").length,
    },
    {
      label: "Without a Team",
      value: rows.filter(({ member, teams }) => needsTeam(member, teams)).length,
      hint: "Owners excluded",
    },
    // Only managers see invitations; other Members see the Team count instead.
    pendingInvitations === undefined
      ? { label: "Teams", value: teamCount }
      : { label: "Pending invitations", value: pendingInvitations },
  ];
}

function filterRows(rows: MemberDirectoryRow[], query: string, filter: MemberFilter) {
  return rows.filter(({ member, teams }) => {
    if (filter === "withoutTeam" && !needsTeam(member, teams)) return false;
    if (filter === "managers" && member.role === "member") return false;
    return matchesSearch(query, [member.name, member.email, ...teams.map(({ name }) => name)]);
  });
}

export function MembersTab({
  hub,
  resources,
  select,
  addPeople,
}: {
  hub: HubAccount;
  resources: TeamResources;
  select(value: TeamSelection): void;
  addPeople(): void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MemberFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const { members, teams, identities } = resources;
  const rows = useMemo(
    () =>
      memberDirectoryRows(
        members.data?.members,
        teams.data?.teams,
        // Other roles only receive their own identities, so a per-Member count would mislead.
        resources.canManageResources ? (identities.data?.identities ?? []) : undefined,
      ),
    [
      identities.data?.identities,
      members.data?.members,
      resources.canManageResources,
      teams.data?.teams,
    ],
  );
  const visible = useMemo(() => filterRows(rows, query, filter), [filter, query, rows]);
  const canManageMembers = hub.signedIn?.capabilities.manageMembers === true;
  const invitations = hub.signedIn?.team?.invitations;
  const shown = showAll ? visible : visible.slice(0, PAGE_SIZE);
  const expand = useCallback(() => setShowAll(true), []);
  const onAddPeople = useCallback(() => addPeople(), [addPeople]);
  const canAddPeople = canAddPeopleToTeams(hub.signedIn?.capabilities);
  const addPeopleButton = useMemo(
    () =>
      canAddPeople ? (
        <Button size="xs" variant="outline" onPress={onAddPeople}>
          Add people
        </Button>
      ) : null,
    [canAddPeople, onAddPeople],
  );
  return (
    <View>
      <SettingsSection title="Overview">
        <ResourceFeedbackGroup queries={[members, teams, identities]} />
        <SummaryStats
          stats={memberStats(
            rows,
            teams.data?.teams.length ?? 0,
            canManageMembers ? (invitations?.length ?? 0) : undefined,
          )}
        />
      </SettingsSection>
      <SettingsSection title="Members" trailing={addPeopleButton}>
        <View style={styles.toolbar}>
          <View style={styles.search}>
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder="Search name, email, or Team"
              clearAccessibilityLabel="Clear Member search"
            />
          </View>
          <SegmentedControl
            options={MEMBER_FILTERS}
            value={filter}
            onValueChange={setFilter}
            size="sm"
          />
        </View>
        <Text style={settingsStyles.rowHint}>
          {visible.length === rows.length
            ? countLabel(rows.length, "Member")
            : `${String(visible.length)} of ${countLabel(rows.length, "Member")}`}
        </Text>
        <View style={settingsStyles.card}>
          {shown.length === 0 ? (
            <EmptyRow
              message={rows.length === 0 ? "No Members are available." : "No Members match."}
            />
          ) : (
            shown.map((row, index) => (
              <MemberDirectoryRowView
                key={row.member.id}
                row={row}
                bordered={index > 0}
                select={select}
              />
            ))
          )}
        </View>
        {shown.length < visible.length ? (
          <Button variant="outline" size="sm" onPress={expand}>
            {`Show all ${String(visible.length)}`}
          </Button>
        ) : null}
      </SettingsSection>
    </View>
  );
}

function MemberDirectoryRowView({
  row,
  bordered,
  select,
}: {
  row: MemberDirectoryRow;
  bordered: boolean;
  select(value: TeamSelection): void;
}) {
  const { member, teams, identityCount } = row;
  const view = useCallback(() => select({ kind: "member", id: member.id }), [member.id, select]);
  const teamNames = memberTeamNames(member, teams);
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{member.name}</Text>
        <Text
          style={settingsStyles.rowHint}
        >{`${member.email} · ${capitalizeLabel(member.role)}`}</Text>
        <Text style={settingsStyles.rowHint}>
          {identityCount === undefined
            ? teamNames
            : `${teamNames} · ${countLabel(identityCount, "Channel identity", "Channel identities")}`}
        </Text>
      </View>
      <Button size="xs" variant="ghost" onPress={view} accessibilityLabel={`View ${member.name}`}>
        View
      </Button>
    </View>
  );
}

function memberTeamNames(member: HubMember, teams: readonly HubTeam[]): string {
  if (teams.length > 0) return teams.map(({ name }) => name).join(", ");
  return member.role === "owner" ? "Full access, no Team needed" : "No Team";
}

const styles = StyleSheet.create((theme) => ({
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  // Takes the whole row on a phone, so the filters wrap below instead of squeezing the input.
  search: {
    flexGrow: 1,
    flexBasis: 280,
    flexDirection: "row",
  },
}));
