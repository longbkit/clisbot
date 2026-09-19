import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TeamAccessSection } from "./team-access-section";
import { TeamMemberRows } from "./team-member-rows";
import { canInvitePeople, canManageTeamMembership } from "./team-membership";
import { RowActionsMenu } from "./row-actions-menu";
import type { HubAccount, HubTeam, TeamResources } from "./types";
import { useTeamAdminAction } from "./use-people-actions";
import type { TeamActions } from "./use-team-actions";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { BackLink } from "../back-link";
import { DetailHeader } from "../detail-header";
import { countLabel } from "../labels";
import { ViewTabs, type ViewTab } from "../view-tabs";

type TeamView = "members" | "access";

/**
 * Members for everyone; Access for Organization Admins and this Team's Team Admins (read-only
 * for the latter). Renaming and deleting are the header's … menu, for Organization Admins.
 */
function teamViews(canManage: boolean) {
  const views: ViewTab<TeamView>[] = [{ value: "members", label: "Members" }];
  if (canManage) views.push({ value: "access", label: "Access" });
  return views;
}

export function SelectedTeamDetail({
  hub,
  team,
  resources,
  actions,
  back,
  manageAccess,
  addPeople,
}: {
  hub: HubAccount;
  team: HubTeam;
  resources: TeamResources;
  actions: TeamActions;
  back(): void;
  manageAccess(): void;
  addPeople(team: HubTeam): void;
}) {
  const [view, setView] = useState<TeamView>("members");
  const { pending, mutationError } = actions;
  const organizationAdmin = resources.canManageResources;
  const canManage = canManageTeamMembership(resources.authority, team.id);
  const canInvite = canInvitePeople(resources.authority, team.id);
  const views = useMemo(() => teamViews(canManage), [canManage]);
  const teamAdmin = useTeamAdminAction(hub, resources, actions.run);
  const removeMember = useCallback(
    (userId: string) => actions.removeTeamMember(team.id, userId),
    [actions, team.id],
  );
  const invite = useCallback(() => addPeople(team), [addPeople, team]);
  const headerActions = useMemo(
    () => (
      <>
        {canInvite ? (
          <Button size="sm" variant="outline" disabled={pending} onPress={invite}>
            Add people
          </Button>
        ) : null}
        {organizationAdmin ? <TeamMenu team={team} actions={actions} onDeleted={back} /> : null}
      </>
    ),
    [actions, back, canInvite, invite, organizationAdmin, pending, team],
  );
  return (
    <View>
      <BackLink to="People & access" onPress={back} disabled={pending} />
      <DetailHeader
        title={team.name}
        subtitle={`Team · ${countLabel(team.userIds.length, "Member")}`}
        actions={headerActions}
      />
      {mutationError ? <Alert variant="error" title={mutationError} /> : null}
      {views.length > 1 ? (
        <View style={styles.tabs}>
          <ViewTabs tabs={views} value={view} onChange={setView} />
        </View>
      ) : null}
      {view === "members" ? (
        <SettingsSection title="Members">
          <TeamMemberRows
            team={team}
            resources={resources}
            pending={pending}
            canManage={canManage}
            teamAdmin={teamAdmin}
            removeMember={removeMember}
          />
        </SettingsSection>
      ) : null}
      {view === "access" && canManage ? (
        <TeamAccessSection
          team={team}
          resources={resources}
          pending={pending}
          manageAccess={manageAccess}
        />
      ) : null}
    </View>
  );
}

/** Rename and Delete, for Organization Admins; Delete asks first and returns to the list. */
function TeamMenu({
  team,
  actions,
  onDeleted,
}: {
  team: HubTeam;
  actions: TeamActions;
  onDeleted(): void;
}) {
  const [renaming, setRenaming] = useState(false);
  const close = useCallback(() => setRenaming(false), []);
  const rename = useCallback(
    async (name: string) => {
      if (!(await actions.renameTeam(team.id, name.trim()))) {
        throw new Error("The Team was not renamed.");
      }
    },
    [actions, team.id],
  );
  const remove = useCallback(async () => {
    if (await actions.removeTeam(team.id, team.name)) onDeleted();
  }, [actions, onDeleted, team.id, team.name]);
  const items = useMemo(
    () => [
      { label: "Rename Team", disabled: actions.pending, onSelect: () => setRenaming(true) },
      {
        label: "Delete Team",
        destructive: true,
        disabled: actions.pending,
        onSelect: () => void remove(),
      },
    ],
    [actions.pending, remove],
  );
  return (
    <>
      <RowActionsMenu label={`Actions for ${team.name}`} actions={items} disabled={false} />
      {renaming ? (
        <AdaptiveRenameModal
          visible
          title="Rename Team"
          initialValue={team.name}
          placeholder="Team name"
          submitLabel="Rename Team"
          maxLength={100}
          onSubmit={rename}
          onClose={close}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  tabs: { marginBottom: theme.spacing[2] },
}));
