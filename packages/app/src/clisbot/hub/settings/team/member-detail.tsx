import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { settingsStyles } from "@/styles/settings";
import { OWNER_ACCESS_HINT } from "../access-catalog";
import { capitalizeLabel } from "../labels";
import { MemberAccessSection } from "./member-access-section";
import { MemberChatAccounts } from "./member-chat-accounts";
import { memberRemoveLockReason, type OrganizationRole } from "./member-role";
import { MemberRoleSelect } from "./member-role-select";
import { MemberTeamsSection } from "./member-teams-section";
import { canManageTeamMembership } from "./team-membership";
import type { HubAccount, HubMember, HubTeam, TeamResources } from "./types";
import type { TeamActions } from "./use-team-actions";
import { BackLink } from "../back-link";
import { DetailHeader, LabeledRow } from "../detail-header";
import { RowActionsMenu } from "./row-actions-menu";

const NO_TEAMS: HubTeam[] = [];
const NO_MEMBERS: HubMember[] = [];

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
  const teams = resources.teams.data?.teams ?? NO_TEAMS;
  const members = resources.members.data?.members ?? NO_MEMBERS;
  const { authority } = resources;
  const canManageTeam = useCallback(
    (teamId: string) => canManageTeamMembership(authority, teamId),
    [authority],
  );
  const lock = memberRemoveLockReason(member, members, capabilities);
  const menu = useMemo(
    () =>
      canManageMembers ? (
        <MemberMenu member={member} lock={lock} actions={actions} back={back} />
      ) : null,
    [actions, back, canManageMembers, lock, member],
  );
  return (
    <View>
      <BackLink to="People & access" onPress={back} disabled={pending} />
      <DetailHeader title={member.name} subtitle={member.email} actions={menu} />
      {actions.mutationError ? <Alert variant="error" title={actions.mutationError} /> : null}
      <SettingsSection title="Details">
        <View style={settingsStyles.card}>
          <LabeledRow label="Role">
            {canManageMembers ? (
              <MemberRoleSelect
                member={member}
                members={members}
                capabilities={capabilities}
                pending={pending}
                setRole={setRole}
              />
            ) : (
              <Text style={settingsStyles.rowTitle}>{capitalizeLabel(member.role)}</Text>
            )}
            {member.role === "owner" ? (
              <Text style={settingsStyles.rowHint}>{OWNER_ACCESS_HINT}</Text>
            ) : null}
          </LabeledRow>
          <LabeledRow label="Status" bordered>
            <Text style={settingsStyles.rowTitle}>Active</Text>
            {canManageMembers && lock !== null ? (
              <Text style={settingsStyles.rowHint}>{lock}</Text>
            ) : null}
          </LabeledRow>
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
          <MemberAccessSection
            member={member}
            teams={teams}
            resources={resources}
            pending={pending}
            manageAccess={manageAccess}
          />
          <MemberChatAccounts
            hub={hub}
            member={member}
            resources={resources}
            run={actions.run}
            pending={pending}
          />
        </>
      ) : null}
    </View>
  );
}

/** Removing the Member sits behind the menu; disabled when the Hub would refuse (why is under Status). */
function MemberMenu({
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
  const items = useMemo(
    () => [
      {
        label: "Remove Member",
        destructive: true,
        disabled: actions.pending || lock !== null,
        onSelect: () => void remove(),
      },
    ],
    [actions.pending, lock, remove],
  );
  return <RowActionsMenu label={`Actions for ${member.name}`} actions={items} disabled={false} />;
}
