import { Children, type ReactElement, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";

/** The schedule form and detail sheet on a wide screen: wide enough for Repeat and Max runs side by side. */
export const SCHEDULE_SHEET_WIDTH = 720;

/**
 * Repeat with Max runs beside it on a wide screen, so the run limit a short cadence requires is
 * in view as the cadence is picked; stacked on a phone. Children: the Repeat field, then Max runs.
 */
export function ScheduleRepeatRow({ children }: { children: ReactNode }): ReactElement {
  const compact = useIsCompactFormFactor();
  const [repeat, maxRuns] = Children.toArray(children);
  if (compact) {
    return (
      <>
        {repeat}
        {maxRuns}
      </>
    );
  }
  return (
    <View style={styles.row}>
      <View style={styles.repeat}>{repeat}</View>
      <View style={styles.maxRuns}>{maxRuns}</View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[4] },
  repeat: { flex: 1, minWidth: 0 },
  maxRuns: { width: 180 },
}));
