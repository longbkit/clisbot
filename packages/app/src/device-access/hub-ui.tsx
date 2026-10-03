import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { Info, Check, Laptop, Network, LockKeyhole } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";

export const HubLaptopIcon = withUnistyles(Laptop);
export const HubNetworkIcon = withUnistyles(Network);
export const HubLockIcon = withUnistyles(LockKeyhole);
const ThemedInfo = withUnistyles(Info);
const ThemedCheck = withUnistyles(Check);
export const hubMutedIconProps = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const successIconProps = (theme: Theme) => ({
  color: theme.colors.statusSuccess,
});
export type HubStatusTone = "success" | "warning" | "muted";
export function HubStatusBadge({ label, tone = "muted" }: { label: string; tone?: HubStatusTone }) {
  return (
    <View
      style={[
        styles.badge,
        tone === "success" && styles.success,
        tone === "warning" && styles.warning,
      ]}
    >
      {tone === "success" ? <ThemedCheck size={12} uniProps={successIconProps} /> : null}
      <Text
        style={[
          styles.badgeLabel,
          tone === "success" && styles.successText,
          tone === "warning" && styles.warningText,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}
export function HubMetadataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.metadata}>
      <Text style={styles.key}>{label}</Text>
      <Text style={styles.value}>{children}</Text>
    </View>
  );
}
export function HubContextNote({ children }: { children: ReactNode }) {
  return (
    <View style={styles.note}>
      <ThemedInfo size={14} uniProps={hubMutedIconProps} />
      <Text style={styles.noteText}>{children}</Text>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  metadata: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  key: {
    width: 64,
    paddingTop: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  value: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: 20,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 3,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface3,
  },
  success: { backgroundColor: theme.colors.statusSuccessTint },
  warning: { backgroundColor: theme.colors.statusWarningTint },
  successText: { color: theme.colors.statusSuccess },
  warningText: { color: theme.colors.statusWarning },
  badgeLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    marginVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[1],
  },
  noteText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.foregroundMuted,
  },
}));
