import { ICON_SIZE, SPACING } from "@/styles/theme";
import { HOME_V2_ENABLED } from "@/clisbot/home/feature";
import { useAvailableHosts } from "@/clisbot/hub/host-inventory";
import { buildHubSettingsRoute } from "@/clisbot/hub/navigation";
import {
  ALL_HOSTS_OPTION_ID,
  getHostFilterPickerValue,
  HostPicker,
} from "@/components/hosts/host-picker";
import { buttonControlHeight, MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";
import { DensityIcon } from "@/components/ui/density-icon";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHasFinePointer } from "@/hooks/use-fine-pointer";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { usePanelStore } from "@/stores/panel-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { density } from "@/styles/density";
import { useOpenSidebarUsage } from "@/usage";
import { router } from "expo-router";
import { CircleGauge, Search, Server, type LucideIcon } from "lucide-react-native";
import { useCallback, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

export const FOOTER_SEARCH_MIN_WIDTH = 104;
const SearchIcon = withUnistyles(Search, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.foregroundMuted,
}));

function sidebarHostOptionTestID(serverId: string): string {
  return `sidebar-host-row-${serverId}`;
}

export function FooterIconButton({
  buttonRef,
  onPress,
  testID,
  label,
  icon,
  iconSizeAdjustment = 0,
  shortcutKeys,
  indicator,
  indicatorTestID,
}: {
  onPress: () => void;
  testID: string;
  label: string;
  icon: LucideIcon;
  /** Only for a glyph that reads larger than the others at the same size. */
  iconSizeAdjustment?: number;
  shortcutKeys?: ReturnType<typeof useShortcutKeys>;
  buttonRef?: RefObject<View | null>;
  indicator?: boolean;
  indicatorTestID?: string;
}) {
  const compact = useIsCompactFormFactor();
  const finePointer = useHasFinePointer();

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          ref={buttonRef}
          style={[
            styles.footerIconButton,
            compact || !finePointer ? styles.footerTouchIconButton : null,
          ]}
          testID={testID}
          nativeID={testID}
          collapsable={false}
          accessible
          accessibilityLabel={label}
          accessibilityRole="button"
          onPress={onPress}
        >
          {({ hovered }) => (
            <View style={styles.footerIconGlyph}>
              <DensityIcon
                icon={icon}
                size="md"
                sizeAdjustment={iconSizeAdjustment}
                color={hovered ? "foreground" : "foregroundMuted"}
              />
              {indicator ? (
                <View
                  style={styles.footerIconIndicator}
                  testID={indicatorTestID}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                />
              ) : null}
            </View>
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8} testID={`${testID}-tooltip`}>
        <IconTooltipContent label={label} shortcutKeys={shortcutKeys} />
      </TooltipContent>
    </Tooltip>
  );
}

export function FooterSearchField() {
  const { t } = useTranslation();
  const shortcutKeys = useShortcutKeys("toggle-command-center");
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const compact = useIsCompactFormFactor();
  const finePointer = useHasFinePointer();
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const openSearch = useCallback(() => {
    if (compact && !HOME_V2_ENABLED) showMobileAgent();
    setCommandCenterOpen(true);
  }, [compact, showMobileAgent, setCommandCenterOpen]);
  const showLabel = useFooterSearchLabelFits(compact);
  return (
    <Pressable
      style={[
        styles.footerSearchField,
        compact || !finePointer ? styles.footerTouchSearchField : null,
        compact ? styles.footerCompactSearchField : null,
        showLabel.fits ? null : styles.footerSearchIconOnly,
      ]}
      onLayout={compact ? showLabel.measureField : undefined}
      testID="sidebar-footer-search"
      accessibilityRole="button"
      accessibilityLabel={t("sidebar.sections.search")}
      onPress={openSearch}
    >
      <SearchIcon />
      {showLabel.fits ? (
        <Text style={styles.footerSearchLabel} numberOfLines={1}>
          {t("sidebar.sections.search")}
        </Text>
      ) : null}
      {compact ? (
        <View
          style={styles.footerSearchMeasureFrame}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={styles.footerSearchLabelMeasure} onLayout={showLabel.measureLabel}>
            {t("sidebar.sections.search")}
          </Text>
        </View>
      ) : null}
      {shortcutKeys ? <Shortcut chord={shortcutKeys} /> : null}
    </Pressable>
  );
}

/**
 * On a phone the footer stays on one line, so the search field may be too narrow for its label.
 * Show the label only when it fits whole (measured, so any language and text size work);
 * otherwise the field keeps just its icon.
 */
function useFooterSearchLabelFits(compact: boolean) {
  const [fieldWidth, setFieldWidth] = useState<number | null>(null);
  const [labelWidth, setLabelWidth] = useState<number | null>(null);
  const measureField = useCallback(
    (event: LayoutChangeEvent) => setFieldWidth(event.nativeEvent.layout.width),
    [],
  );
  const measureLabel = useCallback(
    (event: LayoutChangeEvent) => setLabelWidth(event.nativeEvent.layout.width),
    [],
  );
  // Border, horizontal padding, icon and the gap before the label.
  const chrome = 2 + SPACING[2] * 2 + ICON_SIZE.sm + SPACING[1];
  const fits =
    !compact || fieldWidth === null || labelWidth === null || fieldWidth - chrome >= labelWidth;
  return { fits, measureField, measureLabel };
}

export function SidebarHostPicker({
  label,
  onAddHost,
  onOpenHostSettings,
}: {
  label: string;
  onAddHost: () => void;
  onOpenHostSettings: (serverId: string) => void;
}) {
  const { t } = useTranslation();
  const hosts = useAvailableHosts();
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const pinHostFilter = useSidebarViewStore((state) => state.pinHostFilter);
  const clearHostFilters = useSidebarViewStore((state) => state.clearHostFilters);
  const triggerRef = useRef<View | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const hasActiveHostFilter = hostFilters.length > 0;
  const triggerLabel = hasActiveHostFilter ? t("sidebar.actions.hostsFiltered") : label;

  const handleSelect = useCallback(
    (id: string) => {
      if (id === ALL_HOSTS_OPTION_ID) {
        clearHostFilters();
        return;
      }
      if (hosts.length > 1) {
        pinHostFilter(id);
      }
    },
    [clearHostFilters, hosts.length, pinHostFilter],
  );

  const handleOpen = useCallback(() => setIsOpen(true), []);
  const handleOpenAllHostsSettings = useCallback(() => {
    router.push(buildHubSettingsRoute("hosts"));
  }, []);

  return (
    <HostPicker
      hosts={hosts}
      value={getHostFilterPickerValue(hostFilters)}
      onSelect={handleSelect}
      open={isOpen}
      onOpenChange={setIsOpen}
      anchorRef={triggerRef}
      includeAllHost
      includeAddHost
      onAddHost={onAddHost}
      showActiveConnection
      onOpenHostSettings={onOpenHostSettings}
      onOpenAllHostsSettings={handleOpenAllHostsSettings}
      searchable
      title="Filter by host"
      desktopPlacement="top-start"
      desktopMinWidth={240}
      addHostTestID="sidebar-host-add"
      hostOptionTestID={sidebarHostOptionTestID}
    >
      <FooterIconButton
        buttonRef={triggerRef}
        onPress={handleOpen}
        testID="sidebar-hosts-trigger"
        label={triggerLabel}
        icon={Server}
        // Server's two boxes fill more of the square than the other glyphs.
        iconSizeAdjustment={-1}
        indicator={hasActiveHostFilter}
        indicatorTestID="sidebar-hosts-filter-indicator"
      />
    </HostPicker>
  );
}

export function IconTooltipContent({
  label,
  shortcutKeys,
}: {
  label: string;
  shortcutKeys?: ReturnType<typeof useShortcutKeys>;
}) {
  return (
    <View style={styles.tooltipRow}>
      <Text style={styles.tooltipText}>{label}</Text>
      {shortcutKeys ? <Shortcut chord={shortcutKeys} /> : null}
    </View>
  );
}

export function SidebarUsageIcon({ label }: { label: string }) {
  const openUsage = useOpenSidebarUsage();
  return (
    <FooterIconButton
      onPress={openUsage}
      testID="sidebar-usage-icon"
      label={label}
      icon={CircleGauge}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  footerSearchField: {
    minWidth: FOOTER_SEARCH_MIN_WIDTH,
    height: buttonControlHeight.sm,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  footerSearchLabel: {
    minWidth: 0,
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  footerTouchSearchField: {
    height: MIN_TOUCH_TARGET_SIZE,
    paddingHorizontal: theme.spacing[2],
  },
  footerCompactSearchField: {
    minWidth: MIN_TOUCH_TARGET_SIZE,
    overflow: "hidden",
  },
  footerSearchIconOnly: {
    justifyContent: "center",
  },
  // Wide and unconstrained so the label measures at its natural width; clipped by the field.
  footerSearchMeasureFrame: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 1000,
    flexDirection: "row",
    opacity: 0,
  },
  footerSearchLabelMeasure: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  footerIconButton: {
    width: density.iconButton,
    height: density.iconButton,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
  },
  footerIconGlyph: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  footerTouchIconButton: {
    width: MIN_TOUCH_TARGET_SIZE,
    height: MIN_TOUCH_TARGET_SIZE,
  },
  footerIconIndicator: {
    position: "absolute",
    top: -1,
    right: -2,
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
}));
