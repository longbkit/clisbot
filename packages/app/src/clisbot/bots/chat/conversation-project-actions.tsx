import { useCallback } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { WorkspaceActions } from "@/git/workspace-actions";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useConversationProjectContext } from "./conversation-project-context";
/** Mobile overflow uses the same Git controls and project selection as Explorer. */
export function ConversationProjectActions({ onChoose }: { onChoose?: () => void }) {
  const project = useConversationProjectContext();
  const compact = useIsCompactFormFactor();
  const choose = useCallback(() => {
    onChoose?.();
    project?.chooseBot();
  }, [onChoose, project]);
  if (!project || !compact) return null;
  return (
    <View style={styles.root}>
      <Text style={styles.label}>Project · {project.botName}</Text>
      {project.group ? (
        <Button variant="ghost" onPress={choose}>
          Choose bot project
        </Button>
      ) : null}
      {project.cwd && project.isGit ? (
        <WorkspaceActions serverId={project.serverId} cwd={project.cwd} />
      ) : (
        <Text style={styles.label}>
          {project.cwd
            ? "This project does not use Git."
            : "Project access is required to view files and changes."}
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  root: { gap: 8 },
  label: { fontSize: 14, color: theme.colors.foregroundMuted },
}));
