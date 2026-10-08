import { useCallback, type ReactNode, type Ref } from "react";
import {
  Pressable,
  Text,
  type PressableProps,
  type PressableStateCallbackType,
  type View,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ClisbotBrand } from "@/components/clisbot-brand";
import { MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";

/**
 * The sidebar's top row in the usual workspace-switcher shape: the Clisbot mark, a name and an
 * optional trailing mark passed as children (avatar, chevron) are one button. Other Pressable
 * props and the ref pass through, so a `TooltipTrigger asChild` can wrap it.
 */
export function SidebarTopRow({
  label,
  children,
  isActive,
  onPress,
  accessibilityLabel,
  testID,
  ref,
  ...pressableProps
}: Omit<PressableProps, "style" | "children" | "onPress"> & {
  label: string;
  children?: ReactNode;
  isActive: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  testID: string;
  ref?: Ref<View>;
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
      {...pressableProps}
      ref={ref}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={style}
    >
      <ClisbotBrand iconOnly />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {children}
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
