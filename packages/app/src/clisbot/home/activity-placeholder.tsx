import { useMemo } from "react";
import { View, useWindowDimensions } from "react-native";
import { StyleSheet } from "react-native-unistyles";

const rows = ["first", "second", "third"];
/** Match the activity row height, including the system text scale, before the first snapshot. */
export function ActivityPlaceholder() {
  const { fontScale } = useWindowDimensions();
  const rowStyle = useMemo(() => ({ height: 56 * fontScale }), [fontScale]);
  return (
    <View
      testID="home-activity-placeholder"
      accessibilityLabel="Loading activity"
      accessibilityRole="progressbar"
    >
      {rows.map((key) => (
        <View key={key} style={[styles.row, rowStyle]}>
          <View style={styles.title} />
          <View style={styles.subtitle} />
        </View>
      ))}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  row: { justifyContent: "center", gap: theme.spacing[2] },
  title: {
    width: "60%",
    height: theme.fontSize.sm,
    backgroundColor: theme.colors.surface3,
    borderRadius: theme.borderRadius.sm,
  },
  subtitle: {
    width: "80%",
    height: theme.spacing[2],
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.sm,
  },
}));
