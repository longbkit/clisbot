import { useCallback } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { Menu, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Theme } from "@/styles/theme";
import { chatComposerActions } from "./geometry";

const ThemedMenu = withUnistyles(Menu);
const ThemedX = withUnistyles(X);
const foregroundIcon = (theme: Theme) => ({ color: theme.colors.foreground });
const EXPANDED = { expanded: true } as const;
const COLLAPSED = { expanded: false } as const;

/**
 * Telegram's Menu chip at the container's left edge: it opens the slash command list by doing
 * what typing `/` does (`slash-trigger.ts`), so the list, its filter and its keys are the
 * autocomplete's own. While the list is open it shows ✕ and closes it.
 */
export function ComposerCommandsButton({
  onPress,
  disabled,
  iconSize,
  open,
}: {
  onPress: () => void;
  disabled: boolean;
  iconSize: number;
  /** The command list is open: the chip shows ✕. */
  open: boolean;
}) {
  const { t } = useTranslation();
  const label = t(open ? "composer.layout.closeCommands" : "composer.layout.commands");
  const style = useCallback(
    () => [chatComposerActions.innerTarget, disabled && styles.disabled],
    [disabled],
  );
  const renderFace = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => (
      <View
        testID="composer-commands-face"
        style={[
          chatComposerActions.innerFace,
          hovered ? chatComposerActions.circleHovered : chatComposerActions.chipFace,
        ]}
      >
        {open ? (
          <ThemedX size={iconSize} uniProps={foregroundIcon} />
        ) : (
          <ThemedMenu size={iconSize} uniProps={foregroundIcon} />
        )}
      </View>
    ),
    [iconSize, open],
  );
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={open ? EXPANDED : COLLAPSED}
        testID="composer-commands-button"
        style={style}
      >
        {renderFace}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  disabled: { opacity: theme.opacity[50] },
  tooltipText: { fontSize: theme.fontSize.base, color: theme.colors.popoverForeground },
}));
