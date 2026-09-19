// The top of a Hub detail page (a Member, a Team, an Access entry): the thing's
// name as the page's heading, one line on what it is, and its actions on the
// right, with destructive ones behind the … menu. Under it, facts read as
// label/value rows, not as rows titled with the field's name.

import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";

export function DetailHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.text}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

/** One fact of a detail card: the field on the left, its value (text or a control) beside it. */
export function LabeledRow({
  label,
  bordered = false,
  children,
}: {
  label: string;
  bordered?: boolean;
  children: ReactNode;
}) {
  const compact = useIsCompactFormFactor();
  return (
    <View
      style={[
        settingsStyles.row,
        bordered ? settingsStyles.rowBorder : null,
        compact ? styles.stacked : styles.labeled,
      ]}
    >
      <Text style={[styles.label, compact ? null : styles.labelColumn]}>{label}</Text>
      <View style={styles.value}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    marginBottom: theme.spacing[4],
  },
  text: { flex: 1, minWidth: 200, gap: theme.spacing[1] },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.medium,
  },
  subtitle: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  actions: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  labeled: { alignItems: "flex-start", justifyContent: "flex-start", gap: theme.spacing[4] },
  stacked: { flexDirection: "column", alignItems: "stretch", gap: theme.spacing[1] },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  labelColumn: { width: 140, paddingTop: theme.spacing[1] },
  value: { flex: 1, minWidth: 0, gap: theme.spacing[1] },
}));
