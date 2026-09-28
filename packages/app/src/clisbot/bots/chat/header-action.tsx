import { useCallback, type ComponentType } from "react";
import { Pressable, View, Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { LucideProps } from "lucide-react-native";
import { useIsCompactFormFactor } from "@/constants/layout";
import { iconButtonChromeStyle } from "@/components/ui/icon-button-chrome";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import type { Theme } from "@/styles/theme";
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedIcon = withUnistyles(function ActionIcon({
  icon: Icon,
  color,
  size,
}: {
  icon: ComponentType<LucideProps>;
  color?: string;
  size: number;
}) {
  return <Icon size={size} color={color} />;
});
export function ChatHeaderAction({
  label,
  text,
  icon,
  iconSize = 18,
  onPress,
  disabled = false,
}: {
  label: string;
  text?: string;
  icon: ComponentType<LucideProps>;
  iconSize?: number;
  onPress: () => void;
  disabled?: boolean;
}) {
  const compact = useIsCompactFormFactor();
  const showText = Boolean(text) && !compact;
  const buttonStyle = useCallback(
    (state: PressableStateCallbackType) =>
      iconButtonChromeStyle({
        size: "large",
        state,
        disabled,
        style: [compact && styles.touchTarget, showText && styles.withText],
      }),
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
            <ThemedIcon icon={icon} size={iconSize} uniProps={iconColor} />
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
  touchTarget: { width: 44, height: 44 },
  withText: { width: "auto", flexDirection: "row", gap: 4, paddingHorizontal: 8 },
  text: { color: theme.colors.foregroundMuted, fontSize: 14 },
}));
