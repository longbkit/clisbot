import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import {
  resourceKey,
  subjectAssignments,
  subjectKey,
  type AccessAssignment,
} from "../access-catalog";
import type { GrantActions } from "../access-grants-table";
import { useRemoveGrant } from "../access-queries";
import { GrantAccessMenu, type GrantChoice } from "../access-grant-menu";
import { GrantAccessSheet } from "../access-grant-sheet";
import { countLabel } from "../labels";
import { InfoRow } from "../resource-rows";
import { SubjectGrantsTable } from "../subject-grants-table";
import type {
  HubAccessLevels,
  HubAccessResource,
  HubAssignment,
  HubMember,
  HubTeam,
  TeamResources,
} from "./types";

const NO_MEMBERS: HubMember[] = [];

/** What the grant sheet opens on: a new grant for someone, maybe on a resource, or a stored one. */
interface SheetTarget {
  subject: string | null;
  resource: string | null;
  editing: AccessAssignment | null;
}
const NO_ASSIGNMENTS: HubAssignment[] = [];
const NO_RESOURCES: HubAccessResource[] = [];
const NO_LEVELS: HubAccessLevels = {};

/**
 * A Member's grants: direct ones, then every grant of a Team they are in, marked via that Team.
 * Grant access… opens the grant sheet here, on one of their Teams first or on the Member alone,
 * and each row edits in place, a Team's row on the Team: the same choices as the Access tab.
 */
export function MemberAccessSection({
  member,
  teams,
  resources,
  pending,
  run,
  manageAccess,
}: {
  member: HubMember;
  teams: readonly HubTeam[];
  resources: TeamResources;
  pending: boolean;
  /** The page's mutation runner: a failed removal shows at the top of the Member's page. */
  run(operation: () => Promise<void>): Promise<boolean>;
  manageAccess(): void;
}) {
  const assignments = resources.assignments.data?.assignments ?? NO_ASSIGNMENTS;
  const directCount = subjectAssignments(assignments, "member", member.id).length;
  const joined = useMemo(
    () => teams.filter(({ userIds }) => userIds.includes(member.userId)),
    [member.userId, teams],
  );
  const hasGrants =
    directCount > 0 ||
    joined.some(({ id }) => subjectAssignments(assignments, "team", id).length > 0);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const close = useCallback(() => setSheet(null), []);
  const reload = useCallback(() => void resources.assignments.refetch(), [resources.assignments]);
  const setGranting = useCallback(
    (subject: string) => setSheet({ subject, resource: null, editing: null }),
    [],
  );
  const remove = useRemoveGrant(run, resources.assignments.refetch);
  // The same row actions as the Access tab, in a sheet over this page.
  const actions = useMemo<GrantActions>(
    () => ({
      pending,
      edit: (editing) => setSheet({ subject: null, resource: null, editing }),
      remove,
      grantDirect: (row) =>
        setSheet({
          subject: subjectKey("member", member.id),
          resource: resourceKey(row.resource),
          editing: null,
        }),
    }),
    [member.id, pending, remove],
  );
  const manage = useMemo(
    () => (
      <View style={styles.actions}>
        {hasGrants ? (
          <Button size="sm" variant="ghost" disabled={pending} onPress={manageAccess}>
            Open in Access
          </Button>
        ) : null}
        {/* An Owner already reaches everything; a grant would change nothing. */}
        {member.role === "owner" ? null : (
          <GrantButton member={member} teams={joined} disabled={pending} grant={setGranting} />
        )}
      </View>
    ),
    [hasGrants, joined, manageAccess, member, pending, setGranting],
  );
  return (
    <SettingsSection
      title="Access"
      info={`What ${member.name} can use: ${countLabel(directCount, "direct grant")}, and their Teams' grants marked with the Team.`}
      trailing={manage}
    >
      {member.role === "owner" ? (
        <View style={settingsStyles.card}>
          <InfoRow title="Everything" hint="An Owner's access is automatic; no grant is needed." />
        </View>
      ) : (
        <SubjectGrantsTable
          subjectKind="member"
          subjectId={member.id}
          assignments={assignments}
          resources={resources.catalog.data?.resources ?? NO_RESOURCES}
          accessLevels={resources.catalog.data?.accessLevels ?? NO_LEVELS}
          members={resources.members.data?.members ?? NO_MEMBERS}
          teams={teams}
          empty="No access yet. Grant some, or add them to a Team that has it."
          actions={actions}
        />
      )}
      {sheet === null ? null : (
        <GrantAccessSheet
          subject={sheet.subject}
          resource={sheet.resource}
          editing={sheet.editing}
          close={close}
          onSaved={reload}
        />
      )}
    </SettingsSection>
  );
}

/** A menu with the Member's Teams first when they are in any; otherwise a plain button. */
function GrantButton({
  member,
  teams,
  disabled,
  grant,
}: {
  member: HubMember;
  teams: readonly HubTeam[];
  disabled: boolean;
  grant(subject: string): void;
}) {
  const self = useMemo<GrantChoice>(
    () => ({ key: subjectKey("member", member.id), title: member.name }),
    [member.id, member.name],
  );
  const teamChoices = useMemo<GrantChoice[]>(
    () => teams.map((team) => ({ key: subjectKey("team", team.id), title: team.name })),
    [teams],
  );
  const choose = useCallback((choice: GrantChoice) => grant(choice.key), [grant]);
  const grantSelf = useCallback(() => grant(self.key), [grant, self.key]);
  if (teamChoices.length > 0)
    return (
      <GrantAccessMenu member={self} teams={teamChoices} disabled={disabled} grantTo={choose} />
    );
  return (
    <Button size="sm" variant="outline" disabled={disabled} onPress={grantSelf}>
      Grant access…
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
}));
