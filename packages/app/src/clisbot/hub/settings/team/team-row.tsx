import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { settingsStyles } from "@/styles/settings";
import { teamAccessLine, type TeamDirectoryRow } from "./team-directory";
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
  const { t } = useTranslation();
  const view = useCallback(() => select({ kind: "team", id: team.id }), [select, team.id]);
  const people = [
    t("hub.team.counts.members", { count: team.userIds.length }),
    ...(invitationCount > 0 ? [t("hub.team.counts.invited", { count: invitationCount })] : []),
  ];
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{team.name}</Text>
        <Text style={settingsStyles.rowHint}>{people.join(" · ")}</Text>
        {access === undefined ? null : (
          <View style={styles.access}>
            {access.length === 0 ? (
              <StatusBadge label={t("hub.team.access.none")} variant="warning" />
            ) : (
              <Text style={settingsStyles.rowHint}>{teamAccessLine(access)}</Text>
            )}
          </View>
        )}
      </View>
      <Button
        size="xs"
        variant="ghost"
        onPress={view}
        accessibilityLabel={t("hub.team.teams.viewLabel", { name: team.name })}
      >
        {t("hub.team.actions.view")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  access: { flexDirection: "row", marginTop: theme.spacing[0.5] },
}));
