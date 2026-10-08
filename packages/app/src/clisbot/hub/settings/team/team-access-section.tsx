import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { SubjectGrantsTable } from "../subject-grants-table";
import { ResourceFeedbackGroup } from "../resource-rows";
import type {
  HubAccessLevels,
  HubAccessResource,
  HubAssignment,
  HubMember,
  HubTeam,
  TeamResources,
} from "./types";
import { useTeamAccess } from "./use-people-resources";

const NO_MEMBERS: HubMember[] = [];
const NO_ASSIGNMENTS: HubAssignment[] = [];
const NO_RESOURCES: HubAccessResource[] = [];
const NO_LEVELS: HubAccessLevels = {};

/**
 * A Team's grants. Organization Admins read them from the organization's assignments and can
 * go change them; a Team Admin reads the Team's own grants and cannot change them.
 */
export function TeamAccessSection({
  team,
  resources,
  pending,
  manageAccess,
}: {
  team: HubTeam;
  resources: TeamResources;
  pending: boolean;
  manageAccess(): void;
}) {
  const { t } = useTranslation();
  const members = resources.members.data?.members ?? NO_MEMBERS;
  const teams = useMemo(() => [team], [team]);
  const manage = useMemo(
    () => (
      <Button size="sm" variant="outline" disabled={pending} onPress={manageAccess}>
        {t("hub.team.teamDetail.manageAccess")}
      </Button>
    ),
    [manageAccess, pending, t],
  );
  if (!resources.canManageResources) {
    return <TeamAdminAccess team={team} teams={teams} members={members} />;
  }
  return (
    <SettingsSection
      title={t("hub.team.teamDetail.access")}
      info={t("hub.team.teamDetail.accessInfo")}
      trailing={manage}
    >
      <SubjectGrantsTable
        subjectKind="team"
        subjectId={team.id}
        assignments={resources.assignments.data?.assignments ?? NO_ASSIGNMENTS}
        resources={resources.catalog.data?.resources ?? NO_RESOURCES}
        accessLevels={resources.catalog.data?.accessLevels ?? NO_LEVELS}
        members={members}
        teams={teams}
        empty={t("hub.team.teamDetail.accessEmpty")}
      />
    </SettingsSection>
  );
}

function TeamAdminAccess({
  team,
  teams,
  members,
}: {
  team: HubTeam;
  teams: readonly HubTeam[];
  members: readonly HubMember[];
}) {
  const { t } = useTranslation();
  const access = useTeamAccess(team.id);
  return (
    <SettingsSection title={t("hub.team.teamDetail.access")}>
      <ResourceFeedbackGroup queries={[access]} />
      {access.data === undefined ? null : (
        <SubjectGrantsTable
          subjectKind="team"
          subjectId={team.id}
          assignments={access.data.assignments}
          resources={access.data.resources}
          accessLevels={access.data.accessLevels}
          members={members}
          teams={teams}
          empty={t("hub.team.teamDetail.accessEmptyReadOnly")}
        />
      )}
      <Text style={settingsStyles.rowHint}>{t("hub.team.teamDetail.teamAdminNote")}</Text>
    </SettingsSection>
  );
}
