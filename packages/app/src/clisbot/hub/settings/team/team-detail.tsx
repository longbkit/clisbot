import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TeamAccessSection } from "./team-access-section";
import { TeamMemberRows } from "./team-member-rows";
import { canInvitePeople, canManageTeamMembership } from "./team-membership";
import { TeamSettingsTab } from "./team-settings-tab";
import type { HubAccount, HubTeam, TeamResources } from "./types";
import { useTeamAdminAction } from "./use-people-actions";
import type { TeamActions } from "./use-team-actions";
import { BackLink } from "../back-link";
import { ViewTabs, type ViewTab } from "../view-tabs";

type TeamView = "members" | "access" | "settings";

/**
 * Members for everyone; Access for Organization Admins and this Team's Team Admins (read-only
 * for the latter); Settings (rename, delete) for Organization Admins only.
 */
function teamViews(canManage: boolean, organizationAdmin: boolean) {
  const views: ViewTab<TeamView>[] = [{ value: "members", label: "Members" }];
  if (canManage) views.push({ value: "access", label: "Access" });
  if (organizationAdmin) views.push({ value: "settings", label: "Settings" });
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
  const views = useMemo(
    () => teamViews(canManage, organizationAdmin),
    [canManage, organizationAdmin],
  );
  const teamAdmin = useTeamAdminAction(hub, resources, actions.run);
  const removeMember = useCallback(
    (userId: string) => actions.removeTeamMember(team.id, userId),
    [actions, team.id],
  );
  const invite = useCallback(() => addPeople(team), [addPeople, team]);
  return (
    <View>
      <BackLink to="People" onPress={back} disabled={pending} />
      <SettingsSection title={team.name}>
        <View style={styles.actions}>
          {canInvite ? (
            <Button size="xs" variant="outline" disabled={pending} onPress={invite}>
              Add people
            </Button>
          ) : null}
        </View>
        {mutationError ? <Alert variant="error" title={mutationError} /> : null}
        {views.length > 1 ? <ViewTabs tabs={views} value={view} onChange={setView} /> : null}
      </SettingsSection>
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
      {view === "settings" && organizationAdmin ? (
        <TeamSettingsTab team={team} actions={actions} onDeleted={back} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
}));
