import { useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";

/** Expand in place on the left; open the complete directory on the right. */
export function SectionFooter({
  expanded,
  onToggle,
  count,
  onViewAll,
  testID,
}: {
  expanded: boolean;
  onToggle: () => void;
  count: number;
  onViewAll: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const linkStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.link,
      hovered && styles.hovered,
      pressed && styles.pressed,
    ],
    [],
  );
  return (
    <View style={styles.row} testID={testID}>
      <View style={styles.toggle}>
        <SidebarGroupToggleRow expanded={expanded} onPress={onToggle} testID={`${testID}-toggle`} />
      </View>
      <Pressable accessibilityRole="button" onPress={onViewAll} style={linkStyle}>
        <Text style={styles.text}>{t("bots.workspace.sidebar.viewAll", { count })}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4 },
  toggle: { flexShrink: 1, minWidth: 0 },
  link: {
    minHeight: 36,
    flexShrink: 1,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    marginBottom: theme.spacing[0.5],
    borderRadius: theme.borderRadius.lg,
    justifyContent: "center",
  },
  hovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  pressed: { backgroundColor: theme.colors.surface2 },
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base, textAlign: "right" },
}));
