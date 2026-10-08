import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { settingsStyles } from "@/styles/settings";
import { EmptyRow, ResourceFeedbackGroup } from "../resource-rows";
import { teamDirectoryRows } from "./team-directory";
import { canSeeInvitations } from "./team-membership";
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
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const openCreate = useCallback(() => setCreating(true), []);
  const closeCreate = useCallback(() => setCreating(false), []);
  const { createTeam: create } = actions;
  // The rename modal wants no result back; the new Team shows up in the list.
  const createTeam = useCallback(
    async (name: string) => {
      await create(name);
    },
    [create],
  );
  const canManage = resources.canManageResources;
  const invitations = canSeeInvitations(resources.authority)
    ? (hub.signedIn?.team?.invitations ?? NO_INVITATIONS)
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
          {t("hub.team.teams.newTeam")}
        </Button>
      ) : null,
    [actions.pending, canManage, openCreate, t],
  );
  return (
    <View>
      <SettingsSection title={t("hub.team.teams.title")} trailing={newTeam}>
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
            placeholder={t("hub.team.teams.search")}
            clearAccessibilityLabel={t("hub.team.teams.clearSearch")}
          />
        ) : null}
        <View style={settingsStyles.card}>
          {rows.length === 0 ? (
            <EmptyRow
              message={teams.length === 0 ? t("hub.team.teams.empty") : t("hub.team.teams.noMatch")}
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
          title={t("hub.team.teams.newTeam")}
          initialValue=""
          placeholder={t("hub.team.teams.namePlaceholder")}
          submitLabel={t("hub.team.teams.create")}
          maxLength={100}
          onSubmit={createTeam}
          onClose={closeCreate}
          testID="new-team-dialog"
        />
      ) : null}
    </View>
  );
}
