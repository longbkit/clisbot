import { useCallback, type ComponentType } from "react";
import { Pressable, View, Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { LucideProps } from "lucide-react-native";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import type { Theme } from "@/styles/theme";
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedIcon = withUnistyles(function ActionIcon({
  icon: Icon,
  color,
}: {
  icon: ComponentType<LucideProps>;
  color?: string;
}) {
  return <Icon size={18} color={color} />;
});
export function ChatHeaderAction({
  label,
  text,
  icon,
  onPress,
  disabled = false,
}: {
  label: string;
  text?: string;
  icon: ComponentType<LucideProps>;
  onPress: () => void;
  disabled?: boolean;
}) {
  const compact = useIsCompactFormFactor();
  const showText = Boolean(text) && !compact;
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType) => [
      styles.button,
      showText ? styles.withText : null,
      (compact || isNative) && styles.touch,
      (hovered || pressed) && styles.hovered,
      disabled && styles.disabled,
    ],
    [compact, disabled, showText],
  );
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            disabled={disabled}
            onPress={onPress}
            style={buttonStyle}
          >
            <ThemedIcon icon={icon} uniProps={iconColor} />
            {showText ? <Text style={styles.text}>{text}</Text> : null}
          </Pressable>
        </View>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        <Text>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}
const styles = StyleSheet.create((theme) => ({
  button: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  touch: { minWidth: 48, height: 48 },
  withText: { width: "auto", flexDirection: "row", gap: 4, paddingHorizontal: 8 },
  text: { color: theme.colors.foregroundMuted, fontSize: 14 },
  hovered: { backgroundColor: theme.colors.surface2 },
  disabled: { opacity: 0.4 },
}));
