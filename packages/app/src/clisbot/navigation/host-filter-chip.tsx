import { useCallback } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useRouter } from "expo-router";
import { ChevronDown, Server, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  SidebarHostPicker,
  type SidebarHostPickerTrigger,
} from "@/components/sidebar/sidebar-footer-controls";
import { PressHighlight } from "@/components/ui/press-highlight";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { CONTROL_HEIGHTS } from "@/components/ui/control-geometry";
import { openHostOverview } from "@/navigation/settings-navigation";
import { buildSettingsAddHostRoute } from "@/utils/host-routes";
import { useHostFilter } from "./host-filter";

/** What the Host filter shows in a label: All Hosts, the one Host, or how many. */
export function hostFilterLabel(
  filter: { serverIds: readonly string[]; selected: readonly { label: string }[] },
  t: TFunction,
): string {
  if (filter.serverIds.length === 0) return t("navigation.hostFilter.all");
  if (filter.serverIds.length === 1) return filter.selected[0]?.label ?? filter.serverIds[0]!;
  return t("navigation.hostFilter.several", { count: filter.serverIds.length });
}

/**
 * Home's Host filter, first in its controls because a Host is the widest thing a reader chooses
 * (Owner, 2026-10-26): it opens the same Host picker as the rail and sets the app-wide filter;
 * while it filters, ✕ clears it.
 */
export function HostFilterChip() {
  const { t } = useTranslation();
  const router = useRouter();
  const filter = useHostFilter();
  const addHost = useCallback(() => router.push(buildSettingsAddHostRoute(Date.now())), [router]);
  const label = hostFilterLabel(filter, t);
  const counts = t("navigation.hostFilter.online", { online: filter.online, total: filter.total });
  const renderTrigger = useCallback(
    (trigger: SidebarHostPickerTrigger) => (
      <View ref={trigger.ref} collapsable={false} style={styles.row}>
        <PressHighlight
          accessibilityRole="button"
          accessibilityLabel={`${t("navigation.hostFilter.choose")}: ${label}`}
          onPress={trigger.onPress}
          style={filter.active ? chipActiveStyle : chipStyle}
          testID="home-host-filter"
        >
          <ServerIcon size={14} />
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
          {filter.active ? null : <Text style={styles.count}>{counts}</Text>}
          <ChevronIcon size={14} />
        </PressHighlight>
        {filter.active ? (
          <ToolbarButton
            label={t("navigation.hostFilter.clear")}
            onPress={filter.clear}
            testID="home-host-filter-clear"
          >
            <ClearIcon size={14} />
          </ToolbarButton>
        ) : null}
      </View>
    ),
    [counts, filter.active, filter.clear, label, t],
  );
  return (
    <View style={styles.inset}>
      <SidebarHostPicker
        label={label}
        onAddHost={addHost}
        onOpenHostSettings={openHostOverview}
        renderTrigger={renderTrigger}
        placement="bottom-start"
      />
    </View>
  );
}

const muted = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});
const ServerIcon = withUnistyles(Server, muted);
const ChevronIcon = withUnistyles(ChevronDown, muted);
const ClearIcon = withUnistyles(X, muted);

const styles = StyleSheet.create((theme) => ({
  inset: { paddingHorizontal: theme.spacing[3], flexDirection: "row" },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1], maxWidth: "100%" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minHeight: CONTROL_HEIGHTS.tight,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    flexShrink: 1,
    minWidth: 0,
  },
  chipActive: { backgroundColor: theme.colors.surface2, borderColor: theme.colors.borderAccent },
  label: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
    minWidth: 0,
  },
  count: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));

const chipStyle = styles.chip;
const chipActiveStyle = [styles.chip, styles.chipActive];
