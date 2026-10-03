import { useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronRight } from "lucide-react-native";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";

export type LinkRowTone = "success" | "warning" | "danger" | "neutral";

const Chevron = withUnistyles(ChevronRight);
const muted = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * A settings row that opens another page: the whole row is the target and a chevron says so, so a
 * card of these carries no buttons. A status dot and value say where the thing stands at a glance.
 */
export function SettingsLinkRow({
  label,
  hint,
  value,
  tone,
  onPress,
  testID,
}: {
  label: string;
  hint?: string;
  /** Short state shown before the chevron, e.g. "Connected" or "3 people". */
  value?: string;
  tone?: LinkRowTone;
  onPress?: () => void;
  testID?: string;
}) {
  const style = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      settingsStyles.row,
      styles.row,
      onPress && (hovered || pressed) && styles.hovered,
    ],
    [onPress],
  );
  return (
    <Pressable
      accessibilityRole={onPress ? "link" : undefined}
      disabled={!onPress}
      onPress={onPress}
      testID={testID}
      style={style}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{label}</Text>
        {hint ? (
          <Text style={settingsStyles.rowHint} numberOfLines={1}>
            {hint}
          </Text>
        ) : null}
      </View>
      {value ? (
        <View style={styles.value}>
          {tone && tone !== "neutral" ? <View style={[styles.dot, DOT[tone]]} /> : null}
          <Text style={styles.valueText} numberOfLines={1}>
            {value}
          </Text>
        </View>
      ) : null}
      {onPress ? <Chevron size={16} uniProps={muted} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { gap: theme.spacing[3] },
  hovered: { backgroundColor: theme.colors.surface2 },
  value: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2], flexShrink: 1 },
  valueText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  success: { backgroundColor: theme.colors.statusDotSuccess },
  warning: { backgroundColor: theme.colors.statusDotWarning },
  danger: { backgroundColor: theme.colors.statusDotDanger },
}));

const DOT = { success: styles.success, warning: styles.warning, danger: styles.danger };
