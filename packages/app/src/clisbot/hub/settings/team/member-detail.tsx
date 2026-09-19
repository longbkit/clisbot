import { useCallback } from "react";
import { Text, View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { capitalizeLabel } from "../labels";
import { InfoRow } from "../resource-rows";
import { MemberAccessSection } from "./member-access-section";
import { MemberChatAccounts } from "./member-chat-accounts";
import { memberRemoveLockReason, type OrganizationRole } from "./member-role";
import { MemberRoleSelect } from "./member-role-select";
import { MemberTeamsSection } from "./member-teams-section";
import { canManageTeamMembership } from "./team-membership";
import type { HubAccount, HubMember, TeamResources } from "./types";
import type { TeamActions } from "./use-team-actions";
import { BackLink } from "../back-link";

export function SelectedMemberDetail({
  hub,
  member,
  resources,
  actions,
  back,
  manageAccess,
  setRole,
}: {
  hub: HubAccount;
  member: HubMember;
  resources: TeamResources;
  actions: TeamActions;
  back(): void;
  manageAccess(): void;
  setRole(member: HubMember, role: OrganizationRole): Promise<void>;
}) {
  const { pending } = actions;
  const capabilities = hub.signedIn?.capabilities;
  const canManageMembers = capabilities?.manageMembers === true;
  const teams = resources.teams.data?.teams ?? [];
  const members = resources.members.data?.members ?? [];
  const { authority } = resources;
  const canManageTeam = useCallback(
    (teamId: string) => canManageTeamMembership(authority, teamId),
    [authority],
  );
  return (
    <View>
      <BackLink to="People" onPress={back} disabled={pending} />
      <SettingsSection title={member.name}>
        {actions.mutationError ? <Alert variant="error" title={actions.mutationError} /> : null}
        {member.role === "owner" ? (
          <Alert
            variant="success"
            title="Full organization access"
            description="Owner access is automatic and does not depend on Team or direct assignments."
          />
        ) : null}
        <View style={settingsStyles.card}>
          <InfoRow title="Email" hint={member.email} />
          {canManageMembers ? (
            <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
              <MemberRoleSelect
                member={member}
                members={members}
                capabilities={capabilities}
                pending={pending}
                setRole={setRole}
              />
            </View>
          ) : (
            <InfoRow title="Organization role" hint={capitalizeLabel(member.role)} bordered />
          )}
          <InfoRow title="Status" hint="Active" bordered />
        </View>
      </SettingsSection>
      <MemberTeamsSection
        member={member}
        teams={teams}
        actions={actions}
        canManage={canManageTeam}
      />
      {/* Other roles cannot read Connections or access assignments; Account shows their own. */}
      {resources.canManageResources ? (
        <>
          <MemberChatAccounts
            hub={hub}
            member={member}
            resources={resources}
            run={actions.run}
            pending={pending}
          />
          <MemberAccessSection
            member={member}
            teams={teams}
            resources={resources}
            pending={pending}
            manageAccess={manageAccess}
          />
        </>
      ) : null}
      {canManageMembers ? (
        <MemberDangerZone
          member={member}
          lock={memberRemoveLockReason(member, members, capabilities)}
          actions={actions}
          back={back}
        />
      ) : null}
    </View>
  );
}

/** Removing the Member; disabled, with the Hub's reason, when the Hub would refuse. */
function MemberDangerZone({
  member,
  lock,
  actions,
  back,
}: {
  member: HubMember;
  lock: string | null;
  actions: TeamActions;
  back(): void;
}) {
  const remove = useCallback(async () => {
    if (await actions.removeMember(member.id, member.name)) back();
  }, [actions, back, member.id, member.name]);
  const removeMember = useCallback(() => void remove(), [remove]);
  return (
    <SettingsSection title="Danger zone">
      <Button variant="outline" disabled={actions.pending || lock !== null} onPress={removeMember}>
        Remove Member
      </Button>
      {lock === null ? null : <Text style={settingsStyles.rowHint}>{lock}</Text>}
    </SettingsSection>
  );
}
