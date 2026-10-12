import { useCallback, useMemo } from "react";
import { Search } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { builtinSidebarNavLabelKey } from "@/sidebar-nav/model";

const SearchIcon = withUnistyles(Search, (theme) => ({ color: theme.colors.foregroundMuted }));

/** Mobile has no sidebar search on Home; use the same cross-Host command center. */
export function HomeHeader() {
  const compact = useIsCompactFormFactor();
  const { t } = useTranslation();
  const setOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const search = useCallback(() => setOpen(true), [setOpen]);
  const rightContent = useMemo(
    () =>
      compact ? (
        <HeaderToggleButton
          onPress={search}
          tooltipLabel={t(builtinSidebarNavLabelKey("search"))}
          tooltipKeys={[]}
          tooltipSide="bottom"
          accessibilityRole="button"
          accessibilityLabel={t(builtinSidebarNavLabelKey("search"))}
          testID="home-search"
        >
          <SearchIcon size={20} />
        </HeaderToggleButton>
      ) : null,
    [compact, search, t],
  );
  return <MenuHeader title="Home" borderless rightContent={rightContent} />;
}
