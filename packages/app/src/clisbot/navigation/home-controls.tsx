import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useAvailableHosts } from "@/clisbot/hub/host-inventory";
import { HostFilter } from "@/components/hosts/host-filter";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker";
import { FilterChips, type FilterChip } from "@/components/ui/filter-chips";
import { HOME_CHIPS, type HomeChip } from "./home-feed";
import type { ScopeCounts } from "./ownership";
import { HomePinTags } from "./pin-tags";
import { ScopeTabs } from "./scope-tabs";
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
 * existing activity buckets, Inbox's Host filter, then the reader's pins as tags.
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
    <View style={styles.controls} testID="home-feed-controls">
      <ScopeTabs section="home" counts={scopeCounts} />
      <View style={styles.inset}>
        <FilterChips chips={chips} value={chip} onChange={setChip} scroll testID="home-chip" />
      </View>
      <HomeHostFilter />
      <HomePinTags />
    </View>
  );
}

function HomeHostFilter() {
  const hosts = useAvailableHosts();
  const selected = useNavigationStore((state) => state.homeHosts);
  const setHosts = useNavigationStore((state) => state.setHomeHosts);
  const select = useCallback(
    (serverId: string) => setHosts(serverId === ALL_HOSTS_OPTION_ID ? [] : [serverId]),
    [setHosts],
  );
  if (hosts.length < 2) return null;
  return (
    <View style={styles.inset}>
      <View style={styles.filterRow}>
        <HostFilter
          hosts={hosts}
          selectedHost={selected[0] ?? ALL_HOSTS_OPTION_ID}
          onSelectHost={select}
          triggerTestID="home-host-filter"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  controls: { gap: theme.spacing[2], paddingVertical: theme.spacing[2] },
  inset: { paddingHorizontal: theme.spacing[4] },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
}));
