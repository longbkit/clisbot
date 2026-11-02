import { type ComponentType } from "react";
import { Pressable, View, Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { LucideProps } from "lucide-react-native";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  iconButtonChromeGlyphSize,
  useIconButtonChromeStyle,
} from "@/components/ui/icon-button-chrome";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { PHONE_HEADER_TARGET_SIZE, PhoneHeaderIcon } from "@/clisbot/navigation/phone-header-icon";
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
 * glyph at stroke 1.5, muted; on a phone the section headers' icon and target. `trailingEdge` puts
 * the last control's glyph on the header's right rail, mirroring the sidebar toggle's pull onto
 * the left one.
 */
export function ChatHeaderAction({
  label,
  text,
  icon,
  iconSize = iconButtonChromeGlyphSize("large"),
  onPress,
  disabled = false,
  trailingEdge = false,
  accessibilityState,
  testID,
}: {
  label: string;
  text?: string;
  icon: ComponentType<LucideProps>;
  iconSize?: number;
  onPress: () => void;
  disabled?: boolean;
  trailingEdge?: boolean;
  accessibilityState?: { expanded: boolean };
  testID?: string;
}) {
  const compact = useIsCompactFormFactor();
  const showText = Boolean(text) && !compact;
  const buttonStyle = useIconButtonChromeStyle({
    size: "large",
    disabled,
    style: [
      compact && styles.touchTarget,
      showText && styles.withText,
      trailingEdge && styles.trailingEdge,
    ],
  });
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={accessibilityState}
            disabled={disabled}
            onPress={onPress}
            style={buttonStyle}
            testID={testID}
          >
            {compact ? (
              <PhoneHeaderIcon Icon={icon} />
            ) : (
              <ThemedIcon icon={icon} size={iconSize} uniProps={iconColor} />
            )}
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
  touchTarget: { width: PHONE_HEADER_TARGET_SIZE, height: PHONE_HEADER_TARGET_SIZE },
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
