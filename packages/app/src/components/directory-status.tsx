import { MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";
import { useCallback } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { openHostOverview } from "@/navigation/settings-navigation";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { DirectoryHealth } from "@/hooks/use-directory-health";

/** A reserved line keeps refresh and connection failures from moving the list below it. */
export function DirectoryStatus({
  health,
  label,
  inset = true,
}: {
  health: DirectoryHealth;
  label: string;
  inset?: boolean;
}) {
  const details = useCallback(() => {
    if (health.status !== "unavailable") return;
    if (health.recovery === "retry") {
      // The directory owner publishes a failed retry back into this same status line.
      void getHostRuntimeStore()
        .refreshDirectories(health.serverId)
        .catch(() => undefined);
    } else openHostOverview(health.serverId);
  }, [health]);
  let message = label;
  if (health.status === "loading") message = `Loading ${label.toLowerCase()}…`;
  if (health.status === "refreshing") message = `Refreshing ${label.toLowerCase()}…`;
  if (health.status === "unavailable") message = health.message;
  return (
    <View style={[styles.row, inset && styles.inset]} testID="directory-status">
      <Text
        style={[styles.text, health.status === "unavailable" && styles.error]}
        numberOfLines={1}
        accessibilityLabel={message}
      >
        {message}
      </Text>
      {health.status === "unavailable" ? (
        <Button variant="ghost" size="xs" onPress={details} style={styles.action}>
          {health.recovery === "retry" ? "Retry" : "Details"}
        </Button>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  row: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  action: { minHeight: MIN_TOUCH_TARGET_SIZE, minWidth: MIN_TOUCH_TARGET_SIZE },
  inset: { paddingHorizontal: theme.spacing[4] },
  text: { flex: 1, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.statusWarning },
}));
