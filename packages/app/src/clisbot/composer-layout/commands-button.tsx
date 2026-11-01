import { useCallback } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { Menu } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { composerActionGeometry } from "@/composer/action-geometry";
import type { Theme } from "@/styles/theme";
import { chatComposerInnerAction } from "./geometry";

const ThemedMenu = withUnistyles(Menu);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundIcon = (theme: Theme) => ({ color: theme.colors.foreground });

/**
 * Telegram's ☰ beside the pill: it opens the slash command list by doing what typing `/` does
 * (`slash-trigger.ts`), so the list, its filter and its keys are the autocomplete's own. Drawn
 * with the composer's action geometry, like attach, dictation and voice beside it.
 */
export function ComposerCommandsButton({
  onPress,
  disabled,
  iconSize,
  inner,
}: {
  onPress: () => void;
  disabled: boolean;
  iconSize: number;
  /** Inside a phone's pill: no fill at rest, a 44px target as tall as the pill's row. */
  inner: boolean;
}) {
  const { t } = useTranslation();
  const label = t("composer.layout.commands");
  const style = useCallback(
    () => [
      inner ? chatComposerInnerAction.target : composerActionGeometry.target,
      disabled && styles.disabled,
    ],
    [disabled, inner],
  );
  const renderFace = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => (
      <View
        testID="composer-commands-face"
        style={
          inner
            ? [chatComposerInnerAction.face, hovered && chatComposerInnerAction.hovered]
            : [
                composerActionGeometry.face,
                composerActionGeometry.neutral,
                hovered && composerActionGeometry.hovered,
              ]
        }
      >
        <ThemedMenu size={iconSize} uniProps={hovered ? foregroundIcon : mutedIcon} />
      </View>
    ),
    [iconSize, inner],
  );
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
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
