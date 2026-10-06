import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown } from "lucide-react-native";
import type { Theme } from "@/styles/theme";

const ThemedChevron = withUnistyles(ChevronDown);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * One card of labeled rows, one per setting, so the settings read as a group and each value says
 * what it is. A row with a chevron opens its own picker.
 */
export function SetupCard({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export interface SetupRowLook {
  label: string;
  value: string;
  placeholder?: boolean;
  leading?: ReactNode;
  first?: boolean;
  last?: boolean;
}

/** The row's look; the pressable around it owns the press. */
export function SetupRowView({
  label,
  value,
  placeholder = false,
  leading,
  first = false,
  last = false,
  interactive,
  highlighted,
  testID,
}: SetupRowLook & { interactive: boolean; highlighted: boolean; testID?: string }) {
  return (
    <View
      testID={testID}
      style={[
        styles.row,
        first && styles.first,
        last ? styles.last : styles.divider,
        interactive && highlighted && styles.highlighted,
      ]}
    >
      <Text style={styles.label}>{label}</Text>
      <View style={styles.value}>
        {leading}
        <Text numberOfLines={1} style={[styles.valueText, placeholder && styles.muted]}>
          {value}
        </Text>
      </View>
      {interactive ? <ThemedChevron size={16} uniProps={mutedIcon} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    // No overflow clipping: it cut a focused row's keyboard ring down to two bars. The end rows
    // round their own corners so a hover fill still follows the card.
  },
  first: {
    borderTopLeftRadius: theme.borderRadius.lg - 1,
    borderTopRightRadius: theme.borderRadius.lg - 1,
  },
  last: {
    borderBottomLeftRadius: theme.borderRadius.lg - 1,
    borderBottomRightRadius: theme.borderRadius.lg - 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
  },
  divider: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  highlighted: { backgroundColor: theme.colors.surface2 },
  label: { width: 96, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  value: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  valueText: { flexShrink: 1, color: theme.colors.foreground, fontSize: theme.fontSize.base },
  muted: { color: theme.colors.foregroundMuted },
}));
