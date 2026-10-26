import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { ChipButton } from "@/components/ui/filter-chips";
import { useNavigationStore } from "./store";

const ThemedBot = withUnistyles(Bot, (theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.xs,
}));

/**
 * The Workspace list's Bots chip, beside the grouping tabs: Bot-labelled sessions (and so Bot home
 * projects) are listed while it is on, the default; one tap hides them, counts included.
 */
export function WorkBotsChip() {
  const { t } = useTranslation();
  const shown = useNavigationStore((state) => state.workShowBots);
  const toggle = useNavigationStore((state) => state.toggleWorkShowBots);
  const leading = useMemo(() => <ThemedBot />, []);
  return (
    <ChipButton
      label={t("navigation.work.bots")}
      accessibilityLabel={t(shown ? "navigation.work.hideBots" : "navigation.work.showBots")}
      leading={leading}
      selected={shown}
      onPress={toggle}
      testID="work-bots-chip"
    />
  );
}
