import { useCallback } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { channelIdentityLine } from "../../channel-identity-directory";
import { useChannelCatalog } from "../channel-catalog-queries";
import { AccessSummary, EMPTY_ACCESS_LEVELS, type AccessSummaryEntry } from "../access-summary";
import { capitalizeLabel, countLabel } from "../labels";
import { EmptyRow, InfoRow } from "../resource-rows";
import type { HubAccount, HubMember, HubTeam, TeamResources } from "./types";
import type { TeamActions } from "./use-team-actions";

type OrganizationRole = HubMember["role"];

export function SelectedMemberDetail({
  hub,
  member,
  resources,
  actions,
  back,
  manageAccess,
}: {
  hub: HubAccount;
  member: HubMember;
  resources: TeamResources;
  actions: TeamActions;
  back(): void;
  manageAccess(): void;
}) {
  const { run, pending } = actions;
  const canManageMembers = hub.signedIn?.capabilities.manageMembers === true;
  const canManageTeams = hub.signedIn?.capabilities.manageResources === true;
  const refetchMembers = resources.members.refetch;
  const setRole = useCallback(
    (role: OrganizationRole) =>
      void run(async () => {
        await hub.changeMemberRole({ memberId: member.id, role });
        await refetchMembers();
      }),
    [hub, member.id, refetchMembers, run],
  );
  const remove = useCallback(async () => {
    if (await actions.removeMember(member.id, member.name)) back();
  }, [actions, back, member.id, member.name]);
  const teams = resources.teams.data?.teams ?? [];
  return (
    <View>
      <SettingsSection title={member.name}>
        <View style={styles.actions}>
          <Button size="xs" variant="outline" disabled={pending} onPress={back}>
            Back to Members
          </Button>
        </View>
        {actions.mutationError ? <Alert variant="error" title={actions.mutationError} /> : null}
        <MemberSummary
          member={member}
          pending={pending}
          canManage={canManageMembers}
          setRole={setRole}
          remove={remove}
        />
      </SettingsSection>
      <MemberTeamsSection
        member={member}
        teams={teams}
        pending={pending}
        canManage={canManageTeams}
        actions={actions}
      />
      {/* Other roles cannot read Connections or access assignments; Account shows their own. */}
      {canManageTeams ? (
        <>
          <MemberIdentitiesSection member={member} resources={resources} />
          <MemberAccessSection
            member={member}
            teams={teams}
            resources={resources}
            pending={pending}
            manageAccess={manageAccess}
          />
        </>
      ) : null}
    </View>
  );
}

function MemberSummary({
  member,
  pending,
  canManage,
  setRole,
  remove,
}: {
  member: HubMember;
  pending: boolean;
  canManage: boolean;
  setRole(role: OrganizationRole): void;
  remove(): Promise<void>;
}) {
  const removeMember = useCallback(() => void remove(), [remove]);
  const setMemberRole = useCallback(() => setRole("member"), [setRole]);
  const setAdminRole = useCallback(() => setRole("admin"), [setRole]);
  return (
    <>
      {member.role === "owner" ? (
        <Alert
          variant="success"
          title="Full organization access"
          description="Owner access is automatic and does not depend on Team or direct assignments."
        />
      ) : null}
      <View style={settingsStyles.card}>
        <InfoRow title="Email" hint={member.email} />
        <InfoRow title="Organization role" hint={capitalizeLabel(member.role)} bordered />
        <InfoRow title="Status" hint="Active" bordered />
      </View>
      {canManage && member.role !== "owner" ? (
        <View style={styles.actions}>
          <Button
            size="xs"
            variant={member.role === "member" ? "secondary" : "outline"}
            disabled={pending || member.role === "member"}
            onPress={setMemberRole}
          >
            Member
          </Button>
          <Button
            size="xs"
            variant={member.role === "admin" ? "secondary" : "outline"}
            disabled={pending || member.role === "admin"}
            onPress={setAdminRole}
          >
            Admin
          </Button>
          <Button size="xs" variant="destructive" disabled={pending} onPress={removeMember}>
            Remove Member
          </Button>
        </View>
      ) : null}
    </>
  );
}

function MemberTeamsSection({
  member,
  teams,
  pending,
  canManage,
  actions,
}: {
  member: HubMember;
  teams: readonly HubTeam[];
  pending: boolean;
  canManage: boolean;
  actions: TeamActions;
}) {
  return (
    <SettingsSection title="Teams">
      <View style={settingsStyles.card}>
        {teams.length === 0 ? (
          <EmptyRow message="No Teams yet" />
        ) : (
          teams.map((team, index) => (
            <MemberTeamMembershipRow
              key={team.id}
              team={team}
              userId={member.userId}
              bordered={index > 0}
              pending={pending}
              canManage={canManage}
              actions={actions}
            />
          ))
        )}
      </View>
    </SettingsSection>
  );
}

function MemberTeamMembershipRow({
  team,
  userId,
  bordered,
  pending,
  canManage,
  actions,
}: {
  team: HubTeam;
  userId: string;
  bordered: boolean;
  pending: boolean;
  canManage: boolean;
  actions: TeamActions;
}) {
  const included = team.userIds.includes(userId);
  const { addTeamMembers, removeTeamMember } = actions;
  const toggle = useCallback(() => {
    if (included) removeTeamMember(team.id, userId);
    else void addTeamMembers(team.id, [userId]);
  }, [addTeamMembers, included, removeTeamMember, team.id, userId]);
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{team.name}</Text>
        <Text style={settingsStyles.rowHint}>
          {included ? "Member of this Team" : "Not a member"}
        </Text>
      </View>
      {canManage ? (
        <Button
          size="xs"
          variant={included ? "ghost" : "outline"}
          disabled={pending}
          onPress={toggle}
        >
          {included ? "Remove" : "Add"}
        </Button>
      ) : null}
    </View>
  );
}

function MemberIdentitiesSection({
  member,
  resources,
}: {
  member: HubMember;
  resources: TeamResources;
}) {
  const catalog = useChannelCatalog();
  const identities = (resources.identities.data?.identities ?? []).filter(
    ({ memberId }) => memberId === member.id,
  );
  const connections = resources.connections.data?.connections ?? [];
  return (
    <SettingsSection title="Channel identities">
      <View style={settingsStyles.card}>
        {identities.length === 0 ? (
          <EmptyRow message="No Channel identities linked" />
        ) : (
          identities.map((identity, index) => {
            return (
              <InfoRow
                key={identity.id}
                title={identity.displayName ?? identity.externalSubjectId}
                hint={channelIdentityLine(catalog.entries, identity, connections)}
                bordered={index > 0}
              />
            );
          })
        )}
      </View>
      <Text style={settingsStyles.rowHint}>
        Members link verified identities from Account. Instance operators can manage trusted
        overrides from the Channel identities tab.
      </Text>
    </SettingsSection>
  );
}

function MemberAccessSection({
  member,
  teams,
  resources,
  pending,
  manageAccess,
}: {
  member: HubMember;
  teams: readonly HubTeam[];
  resources: TeamResources;
  pending: boolean;
  manageAccess(): void;
}) {
  const assignments = resources.assignments.data?.assignments ?? [];
  const entries = assignments.flatMap<AccessSummaryEntry>((assignment) => {
    if (assignment.subjectKind === "member" && assignment.subjectId === member.id) {
      return [{ assignment, source: "Direct" }];
    }
    const team = teams.find(({ id }) => id === assignment.subjectId);
    if (assignment.subjectKind === "team" && team?.userIds.includes(member.userId)) {
      return [{ assignment, source: `Via ${team.name}` }];
    }
    return [];
  });
  const directCount = entries.filter(({ source }) => source === "Direct").length;
  return (
    <SettingsSection title="Effective access">
      {member.role === "owner" ? (
        <InfoRow title="Full organization access" hint="Owner · No setup required" />
      ) : (
        <>
          <AccessSummary
            entries={entries}
            resources={resources.catalog.data?.resources ?? []}
            accessLevels={resources.catalog.data?.accessLevels ?? EMPTY_ACCESS_LEVELS}
            emptyMessage="No resource access granted"
          />
          <Text style={settingsStyles.rowHint}>
            {`${countLabel(directCount, "direct assignment")}; Team access is listed with its source.`}
          </Text>
        </>
      )}
      <Button variant="outline" disabled={pending} onPress={manageAccess}>
        Manage access
      </Button>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
