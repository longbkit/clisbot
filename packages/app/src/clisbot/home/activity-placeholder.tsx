import { useMemo } from "react";
import { View, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

const rows = ["first", "second", "third"];
/**
 * Activity rows before the first snapshot, laid out as `ActivityRow` is (inset, leading column,
 * gap, text column, time), so the loaded rows land where the placeholders were.
 */
export function ActivityPlaceholder() {
  const { t } = useTranslation();
  const { fontScale } = useWindowDimensions();
  const rowStyle = useMemo(() => ({ height: 56 * fontScale }), [fontScale]);
  return (
    <View
      testID="home-activity-placeholder"
      accessibilityLabel={t("common.loading")}
      accessibilityRole="progressbar"
    >
      {rows.map((key) => (
        <View key={key} style={[styles.row, rowStyle]} testID="home-activity-placeholder-row">
          <View style={styles.leading}>
            <View style={styles.mark} />
          </View>
          <View style={styles.content}>
            <View style={styles.title} />
            <View style={styles.subtitle} />
          </View>
          <View style={styles.time} />
        </View>
      ))}
    </View>
  );
}
// Insets, gap and the leading width are `ActivityRow`'s (`activity-row.tsx`).
const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
  },
  leading: { width: theme.iconSize.sm, alignItems: "center" },
  mark: {
    width: theme.iconSize.sm,
    height: theme.iconSize.sm,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
  },
  content: { flex: 1, minWidth: 0, gap: theme.spacing[2] },
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
  time: {
    width: 20,
    height: theme.spacing[2],
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.sm,
  },
}));
