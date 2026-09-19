import { useCallback } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { settingsStyles } from "@/styles/settings";
import { countLabel } from "../labels";
import type { TeamDirectoryRow } from "./team-directory";
import type { TeamSelection } from "./types";

export function TeamRow({
  row: { team, invitationCount, access },
  bordered,
  select,
}: {
  row: TeamDirectoryRow;
  bordered: boolean;
  select(value: TeamSelection): void;
}) {
  const view = useCallback(() => select({ kind: "team", id: team.id }), [select, team.id]);
  const people = [
    countLabel(team.userIds.length, "Member"),
    ...(invitationCount > 0 ? [countLabel(invitationCount, "invited")] : []),
  ];
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{team.name}</Text>
        <Text style={settingsStyles.rowHint}>{people.join(" · ")}</Text>
        {access === undefined ? null : (
          <View style={styles.access}>
            {access === "No access" ? (
              <StatusBadge label="No access" variant="warning" />
            ) : (
              <Text style={settingsStyles.rowHint}>{access}</Text>
            )}
          </View>
        )}
      </View>
      <Button size="xs" variant="ghost" onPress={view} accessibilityLabel={`View ${team.name}`}>
        View
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  access: { flexDirection: "row", marginTop: theme.spacing[0.5] },
}));
