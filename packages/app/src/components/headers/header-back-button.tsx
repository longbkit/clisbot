import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "./header-toggle-button";
import {
  iconButtonChromeGlyphSize,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
import type { ShortcutKey } from "@/utils/format-shortcut";

const ThemedArrowLeft = withUnistyles(ArrowLeft);
const NO_SHORTCUT: ShortcutKey[] = [];

export function HeaderBackButton({
  onBack,
  testID = "header-back-button",
}: {
  onBack?: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    if (onBack) onBack();
    else router.back();
  }, [onBack]);
  return (
    <HeaderToggleButton
      onPress={handlePress}
      tooltipLabel={t("common.actions.back")}
      tooltipKeys={NO_SHORTCUT}
      tooltipSide="right"
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t("common.actions.back")}
    >
      <ThemedArrowLeft
        size={iconButtonChromeGlyphSize("large")}
        strokeWidth={1.5}
        uniProps={mutedIconColorMapping}
      />
    </HeaderToggleButton>
  );
}
