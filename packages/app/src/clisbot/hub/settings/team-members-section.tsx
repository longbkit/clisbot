import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import type { SelectFieldOption } from "@/components/ui/select-field";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import type { HubMembersSchema } from "../contracts";
import { capitalizeLabel } from "./labels";
import { MultiSelectField, type MultiSelection } from "./multi-select-field";

type HubMember = z.infer<typeof HubMembersSchema>["members"][number];

const NO_SELECTION: MultiSelection = [];

/**
 * A Team's Members: who is in the Team, and a searchable picker over the rest of the
 * organization. Organization Members outside the Team are never listed as rows, so the list
 * answers "who is in this Team" at a glance however large the organization is.
 */
export function TeamMembersSection({
  teamUserIds,
  members,
  pending,
  canManage,
  addMembers,
  removeMember,
}: {
  teamUserIds: readonly string[];
  members: HubMember[];
  pending: boolean;
  canManage: boolean;
  addMembers(userIds: string[]): Promise<string[]>;
  removeMember(userId: string): void;
}) {
  const inTeam = useMemo(
    () => members.filter(({ userId }) => teamUserIds.includes(userId)),
    [members, teamUserIds],
  );
  const candidates = useMemo(
    () => members.filter(({ userId }) => !teamUserIds.includes(userId)),
    [members, teamUserIds],
  );
  return (
    <SettingsSection title="Members">
      {canManage ? (
        <AddTeamMembers candidates={candidates} pending={pending} addMembers={addMembers} />
      ) : null}
      <View style={settingsStyles.card}>
        {inTeam.length === 0 ? (
          <View style={styles.empty}>
            <Text style={settingsStyles.rowHint}>No Members in this Team yet</Text>
          </View>
        ) : (
          inTeam.map((member, index) => (
            <TeamMemberRow
              key={member.id}
              member={member}
              bordered={index > 0}
              pending={pending}
              canManage={canManage}
              removeMember={removeMember}
            />
          ))
        )}
      </View>
    </SettingsSection>
  );
}

function AddTeamMembers({
  candidates,
  pending,
  addMembers,
}: {
  candidates: HubMember[];
  pending: boolean;
  addMembers(userIds: string[]): Promise<string[]>;
}) {
  const [selection, setSelection] = useState<MultiSelection>(NO_SELECTION);
  const options = useMemo<SelectFieldOption<string>[]>(
    () =>
      candidates.map((member) => ({
        id: member.userId,
        value: member.userId,
        label: member.name,
        description: `${member.email} · ${capitalizeLabel(member.role)}`,
      })),
    [candidates],
  );
  // Drop picks that joined the Team meanwhile, for example through another admin.
  const selectedIds = useMemo(
    () =>
      selection === "*"
        ? []
        : selection.filter((userId) => candidates.some((member) => member.userId === userId)),
    [candidates, selection],
  );
  const add = useCallback(() => {
    // Keep only the Members Hub refused picked, ready to retry.
    void addMembers(selectedIds).then(setSelection);
  }, [addMembers, selectedIds]);
  const count = selectedIds.length;
  return (
    <View style={[settingsStyles.card, styles.form]}>
      <MultiSelectField
        label="Add Members"
        hint={
          candidates.length === 0
            ? "Everyone in the organization is already in this Team."
            : "Search organization Members by name or email."
        }
        options={options}
        value={selectedIds}
        onChange={setSelection}
        disabled={pending || candidates.length === 0}
        placeholder="Choose Members"
        searchPlaceholder="Name or email"
      />
      <Button disabled={pending || count === 0} loading={pending && count > 0} onPress={add}>
        {count > 1 ? `Add ${String(count)} Members` : "Add to Team"}
      </Button>
    </View>
  );
}

function TeamMemberRow({
  member,
  bordered,
  pending,
  canManage,
  removeMember,
}: {
  member: HubMember;
  bordered: boolean;
  pending: boolean;
  canManage: boolean;
  removeMember(userId: string): void;
}) {
  const remove = useCallback(() => removeMember(member.userId), [member.userId, removeMember]);
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{member.name}</Text>
        <Text
          style={settingsStyles.rowHint}
        >{`${member.email} · ${capitalizeLabel(member.role)}`}</Text>
      </View>
      {canManage ? (
        <Button size="xs" variant="ghost" disabled={pending} onPress={remove}>
          Remove
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  empty: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[6],
    alignItems: "center",
  },
}));
