import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react-native";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import type { HomeMode } from "./home-feed";
import { HeaderIconButton, HeaderSearchButton, SectionHeader } from "./section-header";
import { useNavigationStore } from "./store";

const MODES: readonly HomeMode[] = ["chat", "work", "hybrid"];

/** Home's header (brief C5, C13): the Chat / Work / Hybrid switch and Home's search. */
export function NavigationHomeHeader() {
  const { t } = useTranslation();
  const mode = useNavigationStore((state) => state.homeMode);
  const setMode = useNavigationStore((state) => state.setHomeMode);
  const searchOpen = useNavigationStore((state) => state.homeSearchOpen);
  const setSearchOpen = useNavigationStore((state) => state.setHomeSearchOpen);
  const toggleSearch = useCallback(() => setSearchOpen(!searchOpen), [searchOpen, setSearchOpen]);
  const options = useMemo<SegmentedControlOption<HomeMode>[]>(
    () =>
      MODES.map((value) => ({
        value,
        label: t(`navigation.mode.${value}`),
        testID: `home-mode-${value}`,
      })),
    [t],
  );
  const center = useMemo(
    () => (
      <SegmentedControl
        size="xs"
        variant="track"
        options={options}
        value={mode}
        onValueChange={setMode}
        testID="home-mode"
      />
    ),
    [mode, options, setMode],
  );
  const closeLabel = t("navigation.actions.closeSearch");
  const actions = useMemo(
    () =>
      searchOpen ? (
        <HeaderIconButton
          Icon={X}
          label={closeLabel}
          onPress={toggleSearch}
          testID="home-search-close"
        />
      ) : (
        <HeaderSearchButton onPress={toggleSearch} testID="home-search" />
      ),
    [closeLabel, searchOpen, toggleSearch],
  );
  return (
    <SectionHeader
      testID="home-header"
      title={t("navigation.sections.home")}
      center={center}
      actions={actions}
    />
  );
}
