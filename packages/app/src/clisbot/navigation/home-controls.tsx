import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAvailableHosts } from "@/clisbot/hub/host-inventory";
import { DisplayMenuTrigger } from "@/components/ui/display-menu-trigger";
import { DropdownMenu, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import type { FilterChip } from "@/components/ui/filter-chips";
import { DISPLAY_MENU_WIDTH } from "@/components/sidebar/display-preferences/menu";
import { HOME_CHIPS, type HomeChip } from "./home-feed";
import { HostsDisplayItems } from "./hosts-display-items";
import type { ScopeCounts } from "./ownership";
import { HomePinTags } from "./pin-tags";
import { SectionControls, SectionInset } from "./section-controls";
import { useNavigationStore } from "./store";

const CHIP_LABELS: Record<HomeChip, string> = {
  all: "navigation.chips.all",
  needs: "navigation.chips.needs",
  running: "navigation.chips.running",
  updated: "navigation.chips.updated",
  failed: "navigation.chips.failed",
};

/**
 * Home's filters in the brief's order (C7, C7a, C8, C12): scope, quick-filter chips over the
 * existing activity buckets, the Display menu with the Host filter, then the reader's pins.
 */
export function HomeFeedControls({
  scopeCounts,
  chipCounts,
}: {
  scopeCounts: ScopeCounts;
  chipCounts: Record<HomeChip, number>;
}) {
  const { t } = useTranslation();
  const chip = useNavigationStore((state) => state.homeChip);
  const setChip = useNavigationStore((state) => state.setHomeChip);
  const multipleHosts = useAvailableHosts().length > 1;
  const chips = useMemo<FilterChip<HomeChip>[]>(
    () =>
      HOME_CHIPS.map((value) => ({
        value,
        label: t(CHIP_LABELS[value]),
        count: value === "all" ? undefined : chipCounts[value],
      })),
    [chipCounts, t],
  );
  return (
    <SectionControls
      section="home"
      scopeCounts={scopeCounts}
      chips={chips}
      chip={chip}
      onChip={setChip}
      backdrop="surface0"
      display={multipleHosts ? homeDisplayMenu : undefined}
    >
      <SectionInset>
        <HomePinTags />
      </SectionInset>
    </SectionControls>
  );
}

/** Home's Display menu: which Hosts the feed covers. */
function HomeDisplayMenu() {
  const { t } = useTranslation();
  const hosts = useAvailableHosts();
  const selected = useNavigationStore((state) => state.homeHosts);
  const toggle = useNavigationStore((state) => state.toggleHomeHost);
  const clear = useNavigationStore((state) => state.clearHomeHosts);
  return (
    <DropdownMenu>
      <DisplayMenuTrigger
        label={t("navigation.display")}
        active={selected.length > 0}
        testID="home-display"
      />
      <DropdownMenuContent
        align="start"
        width={DISPLAY_MENU_WIDTH}
        sheetTitle={t("navigation.display")}
      >
        <HostsDisplayItems
          hosts={hosts}
          selected={selected}
          onToggle={toggle}
          onClear={clear}
          testID="home-display"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const homeDisplayMenu = <HomeDisplayMenu />;
