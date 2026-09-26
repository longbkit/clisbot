import { useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";
import { entryStatus, type AccessEntry } from "./access-browser-model";
import { tableStyles } from "./table-styles";

/**
 * A Member's Teams over their grants, each with what the Team grants, whether or not it grants
 * anything: a Team without access is often why the Member has none. Pressing a Team opens it.
 */
export function AccessMemberTeams({
  teams,
  onSelect,
}: {
  teams: readonly AccessEntry[];
  onSelect(key: string): void;
}) {
  return (
    <View style={styles.block}>
      <Text style={styles.label}>Teams</Text>
      <View style={settingsStyles.card}>
        {teams.length === 0 ? (
          <View style={[settingsStyles.row, tableStyles.body]}>
            <Text style={tableStyles.cellText}>Not in any Team.</Text>
          </View>
        ) : (
          teams.map((team, index) => (
            <TeamLine key={team.key} team={team} bordered={index > 0} onSelect={onSelect} />
          ))
        )}
      </View>
    </View>
  );
}

function TeamLine({
  team,
  bordered,
  onSelect,
}: {
  team: AccessEntry;
  bordered: boolean;
  onSelect(key: string): void;
}) {
  const press = useCallback(() => onSelect(team.key), [onSelect, team.key]);
  const style = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      settingsStyles.row,
      bordered ? settingsStyles.rowBorder : null,
      tableStyles.body,
      hovered ? tableStyles.hovered : null,
      styles.line,
    ],
    [bordered],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open Team ${team.title}`}
      onPress={press}
      style={style}
    >
      <Text style={styles.name} numberOfLines={1}>
        {team.title}
      </Text>
      <Text style={tableStyles.cellText}>{entryStatus(team)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  block: { gap: theme.spacing[1] },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  line: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  name: { flex: 1, minWidth: 0, color: theme.colors.foreground, fontSize: theme.fontSize.base },
}));
