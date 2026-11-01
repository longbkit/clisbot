import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

/**
 * A command row in the chat layout's command list, as Telegram's: what it does on the left in
 * body text, the command on the right in muted text, its arguments after it
 * (docs/features/composer-picker/README.md, "Layout").
 */
export function ChatCommandRow({
  label,
  detail,
  description,
}: {
  label: string;
  detail: string | undefined;
  description: string | undefined;
}) {
  const command = detail ? `${label} ${detail}` : label;
  return (
    <View style={styles.row}>
      {description ? (
        <Text style={styles.description} numberOfLines={1}>
          {description}
        </Text>
      ) : null}
      <Text
        style={description ? styles.command : styles.commandAlone}
        numberOfLines={1}
        testID="composer-command-name"
      >
        {command}
      </Text>
    </View>
  );
}

/** The command list's drag handle: it reads as a sheet docked on the composer. */
export function ChatCommandListHandle() {
  return (
    <View style={styles.handleRow}>
      <View style={styles.handle} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  description: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  command: {
    flexShrink: 0,
    maxWidth: "50%",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "right",
  },
  commandAlone: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  handleRow: { alignItems: "center", paddingVertical: theme.spacing[1.5] },
  // The bottom sheet's handle (`adaptive-modal-sheet`): a short rounded bar.
  handle: {
    width: theme.spacing[8],
    height: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.border,
  },
}));
