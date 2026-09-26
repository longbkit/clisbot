import { useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Plus } from "lucide-react-native";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Theme } from "@/styles/theme";
const ThemedPlus = withUnistyles(Plus);
const color = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function BotsSectionHeader({
  label,
  testID,
  createLabel,
  onCreate,
  disabled = false,
}: {
  label: string;
  testID: string;
  createLabel: string;
  onCreate: () => void;
  disabled?: boolean;
}) {
  const compact = useIsCompactFormFactor();
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType) => [
      styles.button,
      disabled && styles.disabled,
      (compact || isNative) && styles.touchButton,
      (hovered || pressed) && styles.hovered,
    ],
    [compact, disabled],
  );
  return (
    <View style={styles.header} testID={testID}>
      <Text style={styles.title}>{label}</Text>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <View>
            <Pressable
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={createLabel}
              testID={`${testID}-create`}
              onPress={onCreate}
              style={buttonStyle}
            >
              <ThemedPlus size={16} uniProps={color} />
            </Pressable>
          </View>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          <Text>{createLabel}</Text>
        </TooltipContent>
      </Tooltip>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  header: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[2],
    userSelect: "none",
  },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  button: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  disabled: { opacity: 0.4 },
  touchButton: { width: 44, height: 44 },
  hovered: { backgroundColor: theme.colors.surfaceSidebarHover },
}));
