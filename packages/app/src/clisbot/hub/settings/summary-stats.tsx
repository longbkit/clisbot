import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export interface SummaryStat {
  label: string;
  value: number;
  /** Short context under the label, e.g. "2 expire within a day". */
  hint?: string;
}

/**
 * The counts that open a directory tab. Plain text on the card surface: the numbers are
 * read, not compared, so they get no color or chart.
 */
export function SummaryStats({ stats }: { stats: readonly SummaryStat[] }) {
  return (
    <View style={styles.grid} accessibilityRole="summary">
      {stats.map((stat) => (
        <View key={stat.label} style={styles.tile}>
          <Text style={styles.value}>{String(stat.value)}</Text>
          <Text style={styles.label}>{stat.label}</Text>
          {stat.hint === undefined ? null : <Text style={styles.hint}>{stat.hint}</Text>}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  tile: {
    flexGrow: 1,
    flexBasis: 140,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  value: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["3xl"],
    fontWeight: theme.fontWeight.semibold,
  },
  label: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[0.5],
  },
}));
