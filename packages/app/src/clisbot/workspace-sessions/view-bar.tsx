import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown } from "lucide-react-native";
import { createControlGeometry } from "@/components/ui/control-geometry";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MenuTriggerState } from "@/components/ui/menu/menu-root";
import {
  SegmentedControl,
  segmentedLabelStyle,
  segmentedSegmentStyle,
  type SegmentedControlOption,
} from "@/components/ui/segmented-control";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSidebarViewStore, type SidebarGroupMode } from "@/stores/sidebar-view-store";
import type { Theme } from "@/styles/theme";
import { GROUP_MODE_MENU_ORDER, quickGroupModes } from "./grouping";
import { useSidebarWorkspaceSessions, useWorkspaceSessionsPreferences } from "./model";

/** A tab's label: the short name where the grouping has one, else the menu's full name. */
const TAB_LABEL_KEYS: Record<SidebarGroupMode, string> = {
  project: "sidebar.display.view.project",
  workspace: "sidebar.display.view.workspace",
  session: "sidebar.display.view.session",
  status: "sidebar.display.view.status",
  projectSession: "sidebar.display.grouping.projectSession",
  statusWorkspace: "sidebar.display.grouping.statusWorkspace",
};

const MENU_LABEL_KEYS: Record<SidebarGroupMode, string> = {
  project: "sidebar.display.grouping.project",
  projectSession: "sidebar.display.grouping.projectSession",
  statusWorkspace: "sidebar.display.grouping.statusWorkspace",
  status: "sidebar.display.grouping.status",
  workspace: "sidebar.display.grouping.workspace",
  session: "sidebar.display.grouping.session",
};

const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColor = (theme: Theme) => ({ color: theme.colors.foreground });

/**
 * One line under the Projects header: the two groupings you pick most as tabs, More for all of
 * them, and the Active tag. Both write the same settings as the display menu. Shown only while
 * Agent sessions is on, the switch that gates every Clisbot session view.
 */
export function SidebarViewBar(): ReactElement | null {
  const { visible } = useSidebarWorkspaceSessions();
  if (!visible) return null;
  return (
    <View style={styles.bar} testID="sidebar-view-bar">
      <GroupingTabs />
      <ActiveOnlyTag />
    </View>
  );
}

function GroupingTabs(): ReactElement {
  const { t } = useTranslation();
  const groupMode = useSidebarViewStore((state) => state.groupMode);
  const usage = useSidebarViewStore((state) => state.groupModeUsage);
  const setGroupMode = useSidebarViewStore((state) => state.setGroupMode);
  const tabs = useMemo(() => quickGroupModes(usage), [usage]);
  const options = useMemo<SegmentedControlOption<SidebarGroupMode>[]>(
    () =>
      tabs.map((mode) => ({
        value: mode,
        label: t(TAB_LABEL_KEYS[mode]),
        tooltip: t("sidebar.display.view.groupBy", { mode: t(MENU_LABEL_KEYS[mode]) }),
        testID: `sidebar-view-${mode}`,
      })),
    [t, tabs],
  );
  // A grouping picked from More shows its name on More, selected, until it earns a tab.
  const overflowMode = tabs.includes(groupMode) ? null : groupMode;
  const overflowLabel = overflowMode ? t(TAB_LABEL_KEYS[overflowMode]) : null;
  // More is the control's last segment, inside the same track.
  const more = useMemo(
    () => (
      <MoreGroupings groupMode={groupMode} overflowLabel={overflowLabel} onSelect={setGroupMode} />
    ),
    [groupMode, overflowLabel, setGroupMode],
  );
  return (
    <View style={styles.tabs}>
      <SegmentedControl
        size="xs"
        variant="track"
        options={options}
        value={groupMode}
        onValueChange={setGroupMode}
        trailing={more}
        style={styles.track}
        testID="sidebar-view-grouping"
      />
    </View>
  );
}

function MoreGroupings({
  groupMode,
  overflowLabel,
  onSelect,
}: {
  groupMode: SidebarGroupMode;
  overflowLabel: string | null;
  onSelect: (mode: SidebarGroupMode) => void;
}): ReactElement {
  const { t } = useTranslation();
  const selected = overflowLabel !== null;
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const triggerStyle = useCallback(
    ({ hovered, pressed, open }: MenuTriggerState) => [
      segmentedSegmentStyle({
        size: "xs",
        variant: "track",
        selected,
        hovered: hovered || open,
        pressed,
      }),
      styles.more,
    ],
    [selected],
  );
  // The tooltip wraps the whole menu in a View, as the display menu's trigger does, so the two
  // triggers never fight over one Pressable's handlers.
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <View style={styles.moreSlot}>
          <DropdownMenu>
            <DropdownMenuTrigger
              style={triggerStyle}
              accessibilityLabel={t("sidebar.display.grouping.label")}
              accessibilityState={accessibilityState}
              testID="sidebar-view-more"
            >
              <Text
                style={[
                  segmentedLabelStyle({ size: "xs", selected, variant: "track" }),
                  styles.moreLabel,
                ]}
                numberOfLines={1}
              >
                {overflowLabel ?? t("sidebar.display.view.more")}
              </Text>
              <ThemedChevronDown size={12} uniProps={selected ? foregroundColor : mutedColor} />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              minWidth={200}
              sheetTitle={t("sidebar.display.grouping.label")}
              testID="sidebar-view-more-menu"
            >
              <DropdownMenuLabel testID="sidebar-view-more-heading">
                {t("sidebar.display.grouping.label")}
              </DropdownMenuLabel>
              {GROUP_MODE_MENU_ORDER.map((mode) => (
                <MoreGroupingItem
                  key={mode}
                  mode={mode}
                  selected={mode === groupMode}
                  onSelect={onSelect}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </View>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center">
        <Text>
          {overflowLabel
            ? t("sidebar.display.view.groupBy", { mode: t(MENU_LABEL_KEYS[groupMode]) })
            : t("sidebar.display.view.moreHint")}
        </Text>
      </TooltipContent>
    </Tooltip>
  );
}

function MoreGroupingItem({
  mode,
  selected,
  onSelect,
}: {
  mode: SidebarGroupMode;
  selected: boolean;
  onSelect: (mode: SidebarGroupMode) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onSelect(mode), [mode, onSelect]);
  return (
    <DropdownMenuItem
      selected={selected}
      showSelectedCheck
      onSelect={handleSelect}
      testID={`sidebar-view-more-${mode}`}
    >
      {t(MENU_LABEL_KEYS[mode])}
    </DropdownMenuItem>
  );
}

/** A tag that is on or off; hovering it says what it keeps. */
function ActiveOnlyTag(): ReactElement {
  const { t } = useTranslation();
  const { activeOnly, toggleActiveOnly } = useWorkspaceSessionsPreferences();
  const accessibilityState = useMemo(() => ({ selected: activeOnly }), [activeOnly]);
  const tagStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.tag,
      activeOnly && styles.tagSelected,
      !activeOnly && (hovered || pressed) && styles.tagHovered,
    ],
    [activeOnly],
  );
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("sidebar.display.view.activeOnly")}
          accessibilityState={accessibilityState}
          aria-pressed={activeOnly}
          onPress={toggleActiveOnly}
          style={tagStyle}
          testID="sidebar-view-active-only"
        >
          <Text style={[styles.tagLabel, activeOnly && styles.tagLabelSelected]}>
            {t("sidebar.display.view.active")}
          </Text>
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        <Text>{t("sidebar.display.view.activeOnlyHint")}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

/** In place of an empty grouped list while Active sessions only hides every line. */
export function ActiveOnlyEmptyNote(): ReactElement | null {
  const { t } = useTranslation();
  const { visible, activeOnly } = useSidebarWorkspaceSessions();
  if (!visible || !activeOnly) return null;
  return (
    <Text style={styles.emptyNote} testID="sidebar-view-active-only-empty">
      {t("sidebar.display.view.noActiveSessions")}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => {
  const geometry = createControlGeometry(theme);
  return {
    // The header's own left padding, so the tabs start on the section icon's rail.
    bar: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      paddingHorizontal: theme.spacing[2],
      paddingBottom: theme.spacing[2],
    },
    tabs: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[1],
    },
    track: { flexShrink: 1, minWidth: 0 },
    // More draws as a segment (`segmentedSegmentStyle`); it alone gives way when a long
    // grouping name sits on it.
    more: { flexShrink: 1, minWidth: 0 },
    moreSlot: { flexShrink: 1, minWidth: 0 },
    moreLabel: { flexShrink: 1 },
    tag: {
      ...geometry.segmentedSegmentXs,
      flexShrink: 0,
      justifyContent: "center",
      borderRadius: theme.borderRadius.full,
      borderWidth: theme.borderWidth[1],
      borderColor: theme.colors.border,
    },
    tagHovered: { backgroundColor: theme.colors.surface2 },
    tagSelected: {
      backgroundColor: theme.colors.surface3,
      borderColor: theme.colors.surface3,
    },
    tagLabel: {
      ...geometry.segmentedLabelXs,
      color: theme.colors.foregroundMuted,
    },
    tagLabelSelected: { color: theme.colors.foreground },
    // On the session lines' title rail, as a row would be.
    emptyNote: {
      paddingVertical: theme.spacing[2],
      paddingLeft: theme.spacing[2] + theme.iconSize.md + theme.spacing[2],
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
    },
  };
});
