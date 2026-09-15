import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { copyToClipboard } from "@/utils/copy-to-clipboard";

type CopyState = { status: "idle" | "copying" | "copied" } | { status: "error"; message: string };

/** A terminal command the user runs elsewhere: selectable monospace text with a copy action. */
export function CopyableCommand({
  command,
  copyLabel = "Copy command",
}: {
  command: string;
  copyLabel?: string;
}) {
  const [copyState, setCopyState] = useState<CopyState>({ status: "idle" });
  const copy = useCallback(() => {
    setCopyState({ status: "copying" });
    void copyToClipboard(command)
      .then(() => setCopyState({ status: "copied" }))
      .catch((error: unknown) => {
        setCopyState({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to copy command.",
        });
      });
  }, [command]);
  return (
    <View style={styles.command}>
      <View style={settingsStyles.rowContent}>
        <Text selectable style={styles.commandText}>
          {command}
        </Text>
        {copyState.status === "error" ? (
          <Text style={settingsStyles.rowError}>{copyState.message}</Text>
        ) : null}
      </View>
      <Button size="sm" variant="ghost" loading={copyState.status === "copying"} onPress={copy}>
        {copyState.status === "copied" ? "Copied" : copyLabel}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  command: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingLeft: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  commandText: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
}));
