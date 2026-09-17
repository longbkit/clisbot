import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { useHubAccount } from "../../account-provider";
import {
  HubAccessAssignmentsSchema,
  HubAccessCatalogSchema,
  HubChannelIdentitiesSchema,
  HubConnectionsSchema,
  HubMembersSchema,
  HubTeamsSchema,
} from "../../contracts";
import { ChannelIdentitySettings } from "../channel-identity-settings";
import { useHubResource } from "../hub-resource";
import { MembersTab } from "./members-tab";
import { SelectedMemberDetail } from "./member-detail";
import { SelectedTeamDetail } from "./team-detail";
import { canAddPeopleToTeams } from "./team-membership";
import { TeamsTab } from "./teams-tab";
import { useTeamAdditionDraft } from "./team-addition-form";
import type { TeamResources, TeamSelection } from "./types";
import { useTeamActions } from "./use-team-actions";

type TeamView = "members" | "teams" | "identities";

const TEAM_VIEWS: SegmentedControlOption<TeamView>[] = [
  { value: "members", label: "Members" },
  { value: "teams", label: "Teams" },
  { value: "identities", label: "Channel identities" },
];

function useTeamResources(canManageResources: boolean): TeamResources {
  return {
    canManageResources,
    members: useHubResource("members", HubMembersSchema),
    teams: useHubResource("teams", HubTeamsSchema),
    identities: useHubResource("channel-identities", HubChannelIdentitiesSchema),
    connections: useHubResource("connections", HubConnectionsSchema, canManageResources),
    assignments: useHubResource(
      "access-assignments",
      HubAccessAssignmentsSchema,
      canManageResources,
    ),
    catalog: useHubResource("access-catalog", HubAccessCatalogSchema, canManageResources),
  };
}

/** The tab lives in the URL (`?view=teams`) so a refresh, Back, or a shared link keeps it. */
function useTeamView(): [TeamView, (view: TeamView) => void] {
  const router = useRouter();
  const params = useLocalSearchParams<{ view?: string }>();
  const view = TEAM_VIEWS.find(({ value }) => value === params.view)?.value ?? "members";
  const setView = useCallback((next: TeamView) => router.setParams({ view: next }), [router]);
  return [view, setView];
}

export function TeamSettings() {
  const hub = useHubAccount();
  const capabilities = hub.signedIn?.capabilities;
  const router = useRouter();
  const resources = useTeamResources(capabilities?.manageResources === true);
  const actions = useTeamActions(hub, resources);
  const draft = useTeamAdditionDraft();
  const [view, setView] = useTeamView();
  const [selection, setSelection] = useState<TeamSelection>();
  const back = useCallback(() => setSelection(undefined), []);
  const manageAccess = useCallback(() => {
    if (selection === undefined) return;
    router.push({
      pathname: "/settings/hub/[hubSection]",
      params: { hubSection: "access", subjectKind: selection.kind, subjectId: selection.id },
    });
  }, [router, selection]);
  const addPeople = useCallback(
    (teamIds: string[] = []) => {
      draft.startWithTeams(teamIds);
      setSelection(undefined);
      setView("teams");
    },
    [draft, setView],
  );
  const member =
    selection?.kind === "member"
      ? resources.members.data?.members.find(({ id }) => id === selection.id)
      : undefined;
  if (member !== undefined) {
    return (
      <SelectedMemberDetail
        hub={hub}
        member={member}
        resources={resources}
        actions={actions}
        back={back}
        manageAccess={manageAccess}
      />
    );
  }
  const team =
    selection?.kind === "team"
      ? resources.teams.data?.teams.find(({ id }) => id === selection.id)
      : undefined;
  if (team !== undefined) {
    return (
      <SelectedTeamDetail
        team={team}
        resources={resources}
        actions={actions}
        back={back}
        manageAccess={manageAccess}
        addPeople={addPeople}
        canManage={capabilities?.manageResources === true}
        canInvite={canAddPeopleToTeams(capabilities)}
      />
    );
  }
  return (
    <View>
      <SettingsSection title="Team">
        <SegmentedControl options={TEAM_VIEWS} value={view} onValueChange={setView} size="sm" />
      </SettingsSection>
      {view === "members" ? (
        <MembersTab hub={hub} resources={resources} select={setSelection} addPeople={addPeople} />
      ) : null}
      {view === "teams" ? (
        <TeamsTab
          hub={hub}
          resources={resources}
          actions={actions}
          draft={draft}
          select={setSelection}
        />
      ) : null}
      {view === "identities" ? <ChannelIdentitySettings /> : null}
    </View>
  );
}
