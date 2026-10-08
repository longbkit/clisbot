import { useCallback } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { WorkspaceActions } from "@/git/workspace-actions";
import type { ConversationProjectContextValue } from "./conversation-project-context";
/** Overflow uses the same Git controls and project selection as Explorer. */
export function ConversationProjectActions({
  project,
  onChoose,
}: {
  project: ConversationProjectContextValue;
  onChoose?: () => void;
}) {
  const { t } = useTranslation();
  const choose = useCallback(() => {
    onChoose?.();
    project?.chooseBot();
  }, [onChoose, project]);
  return (
    <View style={styles.root}>
      <Text style={styles.label}>
        {t("bots.chat.projectActions.label", { bot: project.botName })}
      </Text>
      {project.group ? (
        <Button variant="ghost" onPress={choose}>
          {t("bots.chat.common.chooseBotProject")}
        </Button>
      ) : null}
      {project.cwd && project.isGit ? (
        <WorkspaceActions serverId={project.serverId} cwd={project.cwd} />
      ) : (
        <Text style={styles.label}>
          {project.cwd
            ? t("bots.chat.projectActions.noGit")
            : t("bots.chat.projectActions.needAccess")}
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  root: { gap: 8 },
  label: { fontSize: 14, color: theme.colors.foregroundMuted },
}));
