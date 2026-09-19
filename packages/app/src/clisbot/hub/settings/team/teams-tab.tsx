import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { settingsStyles } from "@/styles/settings";
import { HubTeamSchema } from "../../contracts";
import { EmptyRow, ResourceFeedbackGroup } from "../resource-rows";
import { teamDirectoryRows } from "./team-directory";
import { TeamRow } from "./team-row";
import type {
  HubAccount,
  HubManagedInvitation,
  HubTeam,
  TeamResources,
  TeamSelection,
} from "./types";
import type { TeamActions } from "./use-team-actions";

/** Above this many Teams the list gets a search box. */
const TEAM_SEARCH_THRESHOLD = 6;
const NO_INVITATIONS: HubManagedInvitation[] = [];
const NO_TEAMS: HubTeam[] = [];

export function TeamsTab({
  hub,
  resources,
  actions,
  select,
}: {
  hub: HubAccount;
  resources: TeamResources;
  actions: TeamActions;
  select(value: TeamSelection): void;
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const openCreate = useCallback(() => setCreating(true), []);
  const closeCreate = useCallback(() => setCreating(false), []);
  const createTeam = useCreateTeam(hub, resources);
  const canManage = resources.canManageResources;
  const invitations =
    hub.signedIn?.capabilities.manageMembers === true
      ? (hub.signedIn.team?.invitations ?? NO_INVITATIONS)
      : NO_INVITATIONS;
  const teams = resources.teams.data?.teams ?? NO_TEAMS;
  const rows = useMemo(
    () =>
      teamDirectoryRows(
        teams,
        invitations,
        canManage ? (resources.assignments.data?.assignments ?? []) : undefined,
        query,
      ),
    [canManage, invitations, query, resources.assignments.data, teams],
  );
  const newTeam = useMemo(
    () =>
      canManage ? (
        <Button size="xs" variant="outline" disabled={actions.pending} onPress={openCreate}>
          New Team
        </Button>
      ) : null,
    [actions.pending, canManage, openCreate],
  );
  return (
    <View>
      <SettingsSection title="Teams" trailing={newTeam}>
        <ResourceFeedbackGroup
          queries={[
            resources.teams,
            resources.members,
            ...(canManage ? [resources.assignments, resources.catalog] : []),
          ]}
        />
        {actions.mutationError ? <Alert variant="error" title={actions.mutationError} /> : null}
        {teams.length > TEAM_SEARCH_THRESHOLD ? (
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Search Teams"
            clearAccessibilityLabel="Clear Team search"
          />
        ) : null}
        <View style={settingsStyles.card}>
          {rows.length === 0 ? (
            <EmptyRow
              message={
                teams.length === 0
                  ? "No Teams. Owners already have full access."
                  : "No Teams match."
              }
            />
          ) : (
            rows.map((row, index) => (
              <TeamRow key={row.team.id} row={row} bordered={index > 0} select={select} />
            ))
          )}
        </View>
      </SettingsSection>
      {creating ? (
        <AdaptiveRenameModal
          visible
          title="New Team"
          initialValue=""
          placeholder="Team name"
          submitLabel="Create Team"
          maxLength={100}
          onSubmit={createTeam}
          onClose={closeCreate}
          testID="new-team-dialog"
        />
      ) : null}
    </View>
  );
}

/** Creates the Team; the modal shows a refusal in place, so this throws instead of catching. */
function useCreateTeam(hub: HubAccount, resources: TeamResources) {
  const { teams } = resources;
  return useCallback(
    async (name: string) => {
      await hub.api().post("teams", { name: name.trim() }, HubTeamSchema);
      await teams.refetch();
    },
    [hub, teams],
  );
}
