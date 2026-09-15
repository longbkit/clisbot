import { Building2 } from "lucide-react-native";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";

const ThemedBuilding = withUnistyles(Building2);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** The organization name as the heading of a card, so every Hub surface names it the same way. */
export function OrganizationTitle({ name }: { name: string }) {
  return (
    <View style={styles.title}>
      <ThemedBuilding size={20} uniProps={mutedMapping} />
      <Text style={styles.name} numberOfLines={2} accessibilityRole="header">
        {name}
      </Text>
    </View>
  );
}

/** A label/value row under an organization title. */
export function DetailRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <View style={styles.detailValue}>
        <Text selectable style={settingsStyles.rowTitle}>
          {value}
        </Text>
        {hint ? <Text style={settingsStyles.rowHint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  title: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
    minWidth: 0,
  },
  name: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
  },
  detail: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  detailLabel: {
    width: 128,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingTop: 2,
  },
  detailValue: {
    flex: 1,
    minWidth: 0,
  },
}));
