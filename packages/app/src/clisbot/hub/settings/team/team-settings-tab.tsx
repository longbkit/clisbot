import { useCallback, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { settingsStyles } from "@/styles/settings";
import type { HubTeam } from "./types";
import type { TeamActions } from "./use-team-actions";

/** A Team's own settings: its name, and deleting it. Only Organization Admins get here. */
export function TeamSettingsTab({
  team,
  actions,
  onDeleted,
}: {
  team: HubTeam;
  actions: TeamActions;
  onDeleted(): void;
}) {
  const [name, setName] = useState(team.name);
  const rename = useCallback(
    () => void actions.renameTeam(team.id, name.trim()),
    [actions, name, team.id],
  );
  const remove = useCallback(async () => {
    if (await actions.removeTeam(team.id, team.name)) onDeleted();
  }, [actions, onDeleted, team.id, team.name]);
  const removeTeam = useCallback(() => void remove(), [remove]);
  const unchanged = name.trim().length === 0 || name.trim() === team.name;
  return (
    <>
      <SettingsSection title="Settings">
        <View style={[settingsStyles.card, styles.form]}>
          <Field label="Team name">
            <FormTextInput
              key={team.id}
              initialValue={team.name}
              onChangeText={setName}
              editable={!actions.pending}
            />
          </Field>
          <Button variant="outline" disabled={actions.pending || unchanged} onPress={rename}>
            Rename Team
          </Button>
        </View>
      </SettingsSection>
      <SettingsSection title="Danger zone">
        <Button variant="outline" disabled={actions.pending} onPress={removeTeam}>
          Delete Team
        </Button>
      </SettingsSection>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: { padding: theme.spacing[4], gap: theme.spacing[3] },
}));
