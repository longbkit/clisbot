import { memo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Clock } from "lucide-react-native";
import type { Theme } from "@/styles/theme";

const ThemedClock = withUnistyles(Clock);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * The line the daemon writes before each heartbeat run, drawn as a marker across the timeline
 * like a compaction marker: the run is a point in the conversation, not a message.
 */
export const HeartbeatRunMarker = memo(function HeartbeatRunMarker({
  message,
}: {
  message: string;
}) {
  return (
    <View style={styles.container} testID="heartbeat-run-marker">
      <View style={styles.line} />
      <View style={styles.label}>
        <ThemedClock size={12} uniProps={mutedMapping} />
        <Text style={styles.text}>{message}</Text>
      </View>
      <View style={styles.line} />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.border,
  },
  label: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  text: {
    fontFamily: theme.fontFamily.ui,
    fontSize: 13,
    color: theme.colors.foregroundMuted,
  },
}));
