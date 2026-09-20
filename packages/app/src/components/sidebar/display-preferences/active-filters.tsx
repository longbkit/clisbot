import { useCallback, useMemo, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { Folder, Hash, UserRound, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { HostStatusDot } from "@/components/host-status-dot";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { actorLabel } from "@/clisbot/session-storage/actor";
import { channelConversationLabel } from "@/clisbot/channels/channel-icon";
import { sessionMetadataOptions } from "@/clisbot/session-storage/directory";
import { sessionStorageReadable } from "@/clisbot/session-storage/capability";
import { useSessionStore } from "@/stores/session-store";
import { useShallow } from "zustand/react/shallow";
import { useHosts } from "@/runtime/host-runtime";
import { SIDEBAR_UNLABELLED_LABEL_KEY, useSidebarViewStore } from "@/stores/sidebar-view-store";
import { workspaceLabelKey, type WorkspaceLabelColor } from "@getpaseo/protocol/workspace-labels";
import { useWorkspaceLabelProjection } from "@/workspace-labels";
import { WorkspaceLabelDot } from "@/workspace-labels/swatch";
import type { Theme } from "@/styles/theme";
import { buildSidebarFilterChips, type SidebarFilterChip } from "./filter-chips";

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedX = withUnistyles(X);
const ThemedFolder = withUnistyles(Folder);
const ThemedUser = withUnistyles(UserRound);
const ThemedHash = withUnistyles(Hash);

const CHIP_ICON_SIZE = 12;

export function SidebarActiveFilters(): ReactElement | null {
  const { t } = useTranslation();
  const hosts = useHosts();
  const { allProjects, resolvedProjectFilters } = useSidebarModel();
  const { labels } = useWorkspaceLabelProjection();
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const labelFilter = useSidebarViewStore((state) => state.labelFilter);
  const userFilters = useSidebarViewStore((state) => state.userFilters);
  const channelFilters = useSidebarViewStore((state) => state.channelFilters);
  const toggleHostFilter = useSidebarViewStore((state) => state.toggleHostFilter);
  const toggleProjectFilter = useSidebarViewStore((state) => state.toggleProjectFilter);
  const toggleLabelFilter = useSidebarViewStore((state) => state.toggleLabelFilter);
  const toggleUserFilter = useSidebarViewStore((state) => state.toggleUserFilter);
  const toggleChannelFilter = useSidebarViewStore((state) => state.toggleChannelFilter);
  const clearAllFilters = useSidebarViewStore((state) => state.clearAllFilters);

  const metadataHosts = useSessionStore(
    useShallow((state) =>
      Object.values(state.sessions)
        .filter((session) => sessionStorageReadable(session.serverInfo))
        .map((session) => session.workspaces),
    ),
  );
  const metadataOptions = useMemo(
    () => sessionMetadataOptions(metadataHosts.flatMap((workspaces) => [...workspaces.values()])),
    [metadataHosts],
  );

  const chips = useMemo(
    () =>
      buildSidebarFilterChips({
        hostFilters,
        hostLabelById: new Map(
          hosts.map((host) => [host.serverId, host.label?.trim() || host.serverId]),
        ),
        projectFilters: resolvedProjectFilters,
        projectLabelByKey: new Map(
          allProjects.map((project) => [project.viewKey, project.projectName]),
        ),
        labelFilters: labelFilter.labels,
        labelNameByKey: new Map(labels.map((label) => [workspaceLabelKey(label.name), label.name])),
        unlabelledLabel: t("workspaceLabels.unlabelled"),
        userFilters,
        userLabelByKey: new Map(
          [...metadataOptions.users].map(([key, actor]) => [key, actorLabel(actor)]),
        ),
        channelFilters,
        channelLabelByKey: new Map(
          [...metadataOptions.channels].map(([key, channel]) => [
            key,
            channelConversationLabel(channel),
          ]),
        ),
      }),
    [
      allProjects,
      channelFilters,
      hostFilters,
      hosts,
      labelFilter.labels,
      labels,
      metadataOptions.channels,
      metadataOptions.users,
      resolvedProjectFilters,
      t,
      userFilters,
    ],
  );

  const handleRemove = useCallback(
    (chip: SidebarFilterChip) => {
      if (chip.category === "host") toggleHostFilter(chip.value);
      else if (chip.category === "project") toggleProjectFilter(chip.value);
      else if (chip.category === "label") toggleLabelFilter(chip.value);
      else if (chip.category === "user") toggleUserFilter(chip.value);
      else toggleChannelFilter(chip.value);
    },
    [
      toggleChannelFilter,
      toggleHostFilter,
      toggleLabelFilter,
      toggleProjectFilter,
      toggleUserFilter,
    ],
  );

  if (chips.length === 0) return null;

  return (
    <View style={styles.row} testID="sidebar-active-filters">
      {chips.map((chip) => (
        <FilterChip
          key={`${chip.category}:${chip.value}`}
          chip={chip}
          labelColor={
            chip.category === "label"
              ? labels.find((label) => workspaceLabelKey(label.name) === chip.value)?.color
              : undefined
          }
          onRemove={handleRemove}
        />
      ))}
      <Pressable
        onPress={clearAllFilters}
        style={clearStyle}
        accessibilityRole="button"
        accessibilityLabel={t("sidebar.filterEmpty.clear")}
        testID="sidebar-active-filters-clear"
      >
        {({ hovered }) => (
          <Text style={[styles.clearLabel, hovered && styles.clearLabelHovered]}>
            {t("sidebar.filterEmpty.clear")}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

function filterChipCategoryLabel(
  category: SidebarFilterChip["category"],
  t: (key: string) => string,
): string {
  switch (category) {
    case "host":
      return t("sidebar.display.hostFilter.label");
    case "project":
      return t("sidebar.display.projectFilter.label");
    case "label":
      return t("workspaceLabels.title");
    case "user":
      return "User";
    case "channel":
      return "Channel";
  }
}

function FilterChip({
  chip,
  labelColor,
  onRemove,
}: {
  chip: SidebarFilterChip;
  labelColor?: WorkspaceLabelColor;
  onRemove: (chip: SidebarFilterChip) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onRemove(chip), [chip, onRemove]);
  const categoryLabel = filterChipCategoryLabel(chip.category, t);

  return (
    <Pressable
      onPress={handlePress}
      style={chipStyle}
      accessibilityRole="button"
      accessibilityLabel={`Remove ${categoryLabel} filter ${chip.label}`}
      testID={`sidebar-filter-chip-${chip.category}-${chip.value}`}
    >
      <ChipMark chip={chip} labelColor={labelColor} />
      <Text style={styles.chipLabel} numberOfLines={1}>
        {chip.label}
      </Text>
      <ThemedX size={12} strokeWidth={2.2} uniProps={mutedIconMapping} />
    </Pressable>
  );
}

function ChipMark({
  chip,
  labelColor,
}: {
  chip: SidebarFilterChip;
  labelColor?: WorkspaceLabelColor;
}): ReactNode {
  if (chip.category === "host") {
    return <HostStatusDot serverId={chip.value} />;
  }
  if (chip.category === "project") {
    return <ThemedFolder size={CHIP_ICON_SIZE} uniProps={mutedIconMapping} />;
  }
  if (chip.category === "label") {
    if (chip.value === SIDEBAR_UNLABELLED_LABEL_KEY || !labelColor) return null;
    return <WorkspaceLabelDot color={labelColor} />;
  }
  if (chip.category === "user") {
    return <ThemedUser size={CHIP_ICON_SIZE} uniProps={mutedIconMapping} />;
  }
  return <ThemedHash size={CHIP_ICON_SIZE} uniProps={mutedIconMapping} />;
}

function chipStyle({
  pressed,
  hovered = false,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.chip, (hovered || pressed) && styles.chipHovered];
}

function clearStyle({
  pressed,
  hovered = false,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.clear, (hovered || pressed) && styles.clearHovered];
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingRight: theme.spacing[1],
  },
  chip: {
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingLeft: theme.spacing[1.5],
    paddingRight: theme.spacing[1],
    paddingVertical: 3,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  chipHovered: {
    backgroundColor: theme.colors.surface3,
  },
  chipLabel: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  clear: {
    paddingHorizontal: theme.spacing[1],
    paddingVertical: 3,
    borderRadius: theme.borderRadius.md,
  },
  clearHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  clearLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  clearLabelHovered: {
    color: theme.colors.foreground,
  },
}));
