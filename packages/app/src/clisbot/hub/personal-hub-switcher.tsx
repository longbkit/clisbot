import { useCallback } from "react";
import { ChevronRight } from "lucide-react-native";
import { Pressable, Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ClisbotBrand } from "@/components/clisbot-brand";
import { MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";
import type { Theme } from "@/styles/theme";

const Chevron = withUnistyles(ChevronRight);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * The sidebar's top row on a Personal Hub, in the usual workspace-switcher shape: mark, name and
 * a chevron are one button. A Personal Hub has no organization or account to switch, so the row
 * opens the Hub settings.
 */
export function PersonalHubSwitcher({
  isActive,
  onPress,
}: {
  isActive: boolean;
  onPress: () => void;
}) {
  const style = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      (hovered || pressed || isActive) && styles.highlighted,
    ],
    [isActive],
  );
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Personal Hub settings"
      testID="personal-hub-settings"
      style={style}
    >
      <ClisbotBrand iconOnly />
      <Text style={styles.label} numberOfLines={1}>
        Personal Hub
      </Text>
      <Chevron size={16} uniProps={mutedColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flex: 1,
    minWidth: 0,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
    paddingRight: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  highlighted: { backgroundColor: theme.colors.surfaceSidebarHover },
  label: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
}));
