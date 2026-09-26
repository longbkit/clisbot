import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

/** A section label on the geometry of `components/sidebar/pinned-section-header.tsx`, no toggle. */
export function BotsSectionHeader({ label, testID }: { label: string; testID: string }) {
  return (
    <View style={styles.header} testID={testID}>
      <Text style={styles.title}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    userSelect: "none",
  },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
}));
