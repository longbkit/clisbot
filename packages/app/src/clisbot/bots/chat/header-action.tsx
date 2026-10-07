import { useCallback, type ComponentType } from "react";
import { Pressable, View, Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { LucideProps } from "lucide-react-native";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  iconButtonChromeGlyphSize,
  iconButtonChromeStyle,
} from "@/components/ui/icon-button-chrome";
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
  return <Icon size={size} color={color} strokeWidth={1.5} />;
});
/**
 * A chat header control, drawn like the sidebar and Explorer toggles: the shared chrome, a 16pt
 * glyph at stroke 1.5, muted. `trailingEdge` puts the last control's glyph on the header's right
 * rail, mirroring the sidebar toggle's pull onto the left one.
 */
export function ChatHeaderAction({
  label,
  text,
  icon,
  iconSize = iconButtonChromeGlyphSize("large"),
  onPress,
  disabled = false,
  trailingEdge = false,
}: {
  label: string;
  text?: string;
  icon: ComponentType<LucideProps>;
  iconSize?: number;
  onPress: () => void;
  disabled?: boolean;
  trailingEdge?: boolean;
}) {
  const compact = useIsCompactFormFactor();
  const showText = Boolean(text) && !compact;
  const buttonStyle = useCallback(
    (state: PressableStateCallbackType) =>
      iconButtonChromeStyle({
        size: "large",
        state,
        disabled,
        style: [
          compact && styles.touchTarget,
          showText && styles.withText,
          trailingEdge && styles.trailingEdge,
        ],
      }),
    [compact, disabled, showText, trailingEdge],
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
  withText: {
    width: "auto",
    flexDirection: "row",
    gap: theme.spacing[1.5],
    paddingLeft: theme.spacing[2],
    // Optical: a word ends with less ink than a glyph starts, so its side gets more room.
    paddingRight: theme.spacing[3],
  },
  trailingEdge: { marginRight: { xs: 0, md: -theme.spacing[2] } },
  text: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: theme.iconSize.md + 4,
  },
}));
