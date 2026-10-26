import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { FilterChip } from "@/components/ui/filter-chips";
import { HOME_CHIPS, type HomeChip } from "./home-feed";
import type { ScopeCounts } from "./ownership";
import { HomePinTags } from "./pin-tags";
import { HostFilterChip } from "./host-filter-chip";
import { SectionControls } from "./section-controls";
import { useNavigationStore } from "./store";

const CHIP_LABELS: Record<HomeChip, string> = {
  all: "navigation.chips.all",
  needs: "navigation.chips.needs",
  running: "navigation.chips.running",
  updated: "navigation.chips.updated",
  failed: "navigation.chips.failed",
};

/**
 * Home's filters, widest first: the app-wide Host filter, scope, quick-filter chips over the
 * existing activity buckets, then the reader's pins (C7, C8, C12; Owner, 2026-10-26).
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
      leading={hostFilterChip}
    >
      <HomePinTags />
    </SectionControls>
  );
}

const hostFilterChip = <HostFilterChip />;
