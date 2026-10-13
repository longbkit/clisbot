import { HOME_V2_ENABLED } from "@/clisbot/home/feature";
import { rememberChatReturn } from "@/clisbot/home/mobile-navigation";
import { BotsSectionHeader, useSectionCollapsed } from "@/clisbot/bots/sidebar/section-header";
import { SidebarViewBar } from "@/clisbot/workspace-sessions/view-bar";
import { useBotsFeatureHosts } from "@/clisbot/bots/feature";
import { BotsAndChatsSidebarSections } from "@/clisbot/bots/sidebar/sections";
import { QuickChatsSection } from "@/clisbot/quick-chats/quick-chats-section";
import { router } from "expo-router";
import {
  CircleGauge,
  FolderPlus,
  GitBranch,
  Import,
  Search,
  Server,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Pressable,
  StyleSheet as RNStyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Gesture } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { resolveDesktopSidebarWidth } from "@/components/desktop-sidebar-layout";
import {
  SIDEBAR_RESIZE_ACTIVATION_OFFSET,
  SIDEBAR_RESIZE_FAIL_OFFSET,
} from "@/components/sidebar-resize-handle-layout";
import {
  ALL_HOSTS_OPTION_ID,
  getHostFilterPickerValue,
  HostPicker,
} from "@/components/hosts/host-picker";
import { SidebarActiveFilters } from "@/components/sidebar/display-preferences/active-filters";
import { SidebarDisplayPreferencesMenu } from "@/components/sidebar/display-preferences/menu";
import { SidebarSeparator } from "@/components/sidebar/sidebar-separator";
import { SidebarHelpMenu } from "@/components/sidebar/sidebar-help-menu";
import { SidebarNewMenu } from "@/components/sidebar/sidebar-new-menu";
import { SidebarResizeHandle } from "@/components/sidebar-resize-handle";
import { DensityIcon } from "@/components/ui/density-icon";
import { Shortcut } from "@/components/ui/shortcut";
import { buttonControlHeight, MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HEADER_INNER_HEIGHT, useIsCompactFormFactor } from "@/constants/layout";
import { useHasFinePointer } from "@/hooks/use-fine-pointer";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useImportSession } from "@/hooks/use-import-session";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import {
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { density } from "@/styles/density";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { useSidebarFooterItems } from "@/sidebar-nav/use-sidebar-footer-items";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import type { PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import { RetainedPanelActivity } from "@/components/retained-panel";
import type { StatusDisplayGroup } from "@/clisbot/workspace-sessions/status-sessions";
import type { SidebarProjectIconTarget } from "@/utils/sidebar-project-row-model";
import { type SidebarGroupMode, useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useAvailableHosts } from "@/clisbot/hub/host-inventory";
import { buildHubSettingsRoute } from "@/clisbot/hub/navigation";
import { PluginSidebarItem } from "@/plugins/sidebar-items";
import { builtinSidebarNavLabelKey } from "@/sidebar-nav/model";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { usePanelStore } from "@/stores/panel-store";
import { useOwnsWindowChromeCorner, WindowChromeSafeArea } from "@/utils/desktop-window";
import { useCloseAgentListGesture } from "@/mobile-panels/gestures";
import { MobilePanelOverlay } from "@/mobile-panels/presentation";
import { buildSettingsAddHostRoute, buildSettingsRoute } from "@/utils/host-routes";
import { openHostOverview } from "@/navigation/settings-navigation";
import {
  UsageSidebarItem,
  UsageSidebarRoot,
  useHasUsageSummary,
  useOpenSidebarUsage,
} from "@/usage";
import { SidebarAgentListSkeleton } from "./sidebar-agent-list-skeleton";
import { SidebarCalloutSlot } from "./sidebar-callout-slot";
import { SidebarMetadataNotice } from "./sidebar/empty-states";
import { SidebarWorkspaceList } from "./sidebar-workspace-list";
import { SidebarNavGroup } from "@/clisbot/hub/sidebar-nav-group";
import { SidebarNavRows } from "@/components/sidebar/sidebar-nav-rows";

type SidebarTheme = ReturnType<typeof useUnistyles>["theme"];

const DEV_BUILD_LABEL = process.env.EXPO_PUBLIC_CLISBOT_DEV_BUILD_LABEL?.trim() || null;
const FOOTER_SEARCH_MIN_WIDTH = 104;

interface SidebarSharedProps {
  theme: SidebarTheme;
  workspaceGroups: StatusDisplayGroup[];
  projectIconTargets: SidebarProjectIconTarget[];
  pinnedGroups: PinnedSidebarGroups;
  projects: SidebarProjectEntry[];
  hasProjectsBeforeFilter: boolean;
  hasActiveProjectFilter: boolean;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  isManualRefresh: boolean;
  groupMode: SidebarGroupMode;
  collapsedProjectKeys: ReadonlySet<string>;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  toggleProjectCollapsed: (projectViewKey: string) => void;
  handleRefresh: () => void;
  handleOpenProject: () => void;
  handleImportSession: () => void;
  handleSettings: () => void;
  labels: SidebarLabels;
  handleAddHost: () => void;
  handleOpenHostSettings: (serverId: string) => void;
}

interface SidebarLabels {
  addProject: string;
  hosts: string;
  importSession: string;
  settings: string;
  searchHosts: string;
  usage: string;
  closeSidebar: string;
}

interface MobileSidebarProps extends SidebarSharedProps {
  active: boolean;
  insetsTop: number;
  insetsBottom: number;
  closeSidebar: () => void;
}

interface DesktopSidebarProps extends SidebarSharedProps {
  insetsTop: number;
  active: boolean;
}

export const LeftSidebar = memo(function LeftSidebar({ active }: { active: boolean }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isCompactLayout = useIsCompactFormFactor();
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);

  const {
    projects,
    hasProjectsBeforeFilter,
    resolvedProjectFilters,
    workspaceEntriesByKey,
    isInitialLoad,
    isRevalidating,
    refreshAll,
    workspaceGroups,
    projectIconTargets,
    pinnedGroups,
    collapsedProjectKeys,
    toggleProjectCollapsed,
    groupMode,
    shortcutModel,
  } = useSidebarModel();
  const { shortcutIndexByWorkspaceKey } = shortcutModel;

  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!isRevalidating && isManualRefresh) {
      setIsManualRefresh(false);
    }
  }, [isRevalidating, isManualRefresh]);

  const openProjectPicker = useOpenAddProject();
  const { open: openImportSession, sheet: importSessionSheet } = useImportSession();

  const handleOpenProjectMobile = useCallback(() => {
    showMobileAgent();
    void openProjectPicker();
  }, [showMobileAgent, openProjectPicker]);

  const handleOpenProjectDesktop = useCallback(() => {
    void openProjectPicker();
  }, [openProjectPicker]);

  const handleSettingsMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildSettingsRoute());
  }, [showMobileAgent]);

  const handleSettingsDesktop = useCallback(() => {
    router.push(buildSettingsRoute());
  }, []);

  const handleAddHostMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildSettingsAddHostRoute(Date.now()));
  }, [showMobileAgent]);

  const handleAddHostDesktop = useCallback(() => {
    router.push(buildSettingsAddHostRoute(Date.now()));
  }, []);

  const handleOpenHostSettingsMobile = useCallback(
    (serverId: string) => {
      showMobileAgent();
      openHostOverview(serverId);
    },
    [showMobileAgent],
  );

  const handleOpenHostSettingsDesktop = useCallback((serverId: string) => {
    openHostOverview(serverId);
  }, []);

  const handleImportSessionMobile = useCallback(() => {
    showMobileAgent();
    openImportSession();
  }, [openImportSession, showMobileAgent]);

  const labels = useMemo(
    (): SidebarLabels => ({
      addProject: t("sidebar.actions.addProject"),
      hosts: t("sidebar.actions.hosts"),
      importSession: t("importSession.title"),
      settings: t("sidebar.actions.settings"),
      searchHosts: t("sidebar.host.searchPlaceholder"),
      usage: t(builtinSidebarNavLabelKey("usage")),
      closeSidebar: t("sidebar.actions.closeSidebar"),
    }),
    [t],
  );

  const sharedProps = {
    theme,
    workspaceGroups,
    projectIconTargets,
    pinnedGroups,
    projects,
    hasProjectsBeforeFilter,
    hasActiveProjectFilter: resolvedProjectFilters.length > 0,
    workspaceEntriesByKey,
    isInitialLoad,
    isRevalidating,
    isManualRefresh,
    groupMode,
    collapsedProjectKeys,
    shortcutIndexByWorkspaceKey,
    toggleProjectCollapsed,
    handleRefresh,
    labels,
  };

  if (isCompactLayout) {
    return (
      <>
        <RetainedPanelActivity active={active}>
          <MobileSidebar
            {...sharedProps}
            active={active}
            insetsTop={insets.top}
            insetsBottom={insets.bottom}
            closeSidebar={showMobileAgent}
            handleOpenProject={handleOpenProjectMobile}
            handleImportSession={handleImportSessionMobile}
            handleSettings={handleSettingsMobile}
            handleAddHost={handleAddHostMobile}
            handleOpenHostSettings={handleOpenHostSettingsMobile}
          />
        </RetainedPanelActivity>
        {importSessionSheet}
      </>
    );
  }

  return (
    <>
      <RetainedPanelActivity active={active}>
        <DesktopSidebar
          {...sharedProps}
          insetsTop={insets.top}
          active={active}
          handleOpenProject={handleOpenProjectDesktop}
          handleImportSession={openImportSession}
          handleSettings={handleSettingsDesktop}
          handleAddHost={handleAddHostDesktop}
          handleOpenHostSettings={handleOpenHostSettingsDesktop}
        />
      </RetainedPanelActivity>
      {importSessionSheet}
    </>
  );
});

function sidebarHostOptionTestID(serverId: string): string {
  return `sidebar-host-row-${serverId}`;
}

function FooterIconButton({
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

function FooterSearchField({ theme }: { theme: SidebarTheme }) {
  const { t } = useTranslation();
  const shortcutKeys = useShortcutKeys("toggle-command-center");
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const compact = useIsCompactFormFactor();
  const finePointer = useHasFinePointer();
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const openSearch = useCallback(() => {
    if (compact) showMobileAgent();
    setCommandCenterOpen(true);
  }, [compact, showMobileAgent, setCommandCenterOpen]);
  const showLabel = useFooterSearchLabelFits(compact, theme);
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
      <Search size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
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
function useFooterSearchLabelFits(compact: boolean, theme: SidebarTheme) {
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
  const chrome = 2 + theme.spacing[2] * 2 + theme.iconSize.sm + theme.spacing[1];
  const fits =
    !compact || fieldWidth === null || labelWidth === null || fieldWidth - chrome >= labelWidth;
  return { fits, measureField, measureLabel };
}

function SidebarHostPicker({
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

function IconTooltipContent({
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

function SidebarFooter({
  handleOpenProject,
  handleImportSession,
  handleSettings,
  labels,
  handleAddHost,
  handleOpenHostSettings,
  onBeforeNavigate,
}: {
  handleOpenProject: () => void;
  handleImportSession: () => void;
  handleSettings: () => void;
  labels: {
    addProject: string;
    hosts: string;
    importSession: string;
    settings: string;
    searchHosts: string;
    usage: string;
  };
  handleAddHost: () => void;
  handleOpenHostSettings: (serverId: string) => void;
  onBeforeNavigate?: () => void;
}) {
  const newAgentKeys = useShortcutKeys("new-agent");
  const settingsKeys = useShortcutKeys("toggle-settings");
  const { theme } = useUnistyles();
  const { items } = useSidebarFooterItems();
  const compact = useIsCompactFormFactor();
  const finePointer = useHasFinePointer();
  const touchTarget = compact || !finePointer;
  const actions = items.filter((item) => item.visible && item.group === "actions");
  // A phone keeps every footer action on one line: search shrinks to its icon instead of wrapping.
  const actionWidths: Record<string, number> = {
    search: compact ? MIN_TOUCH_TARGET_SIZE : FOOTER_SEARCH_MIN_WIDTH,
    new: touchTarget ? MIN_TOUCH_TARGET_SIZE : buttonControlHeight.sm,
    "add-project": touchTarget ? MIN_TOUCH_TARGET_SIZE : buttonControlHeight.xs,
  };
  const actionMinWidth =
    actions.reduce((width, item) => width + actionWidths[item.key], 0) +
    Math.max(0, actions.length - 1) * theme.spacing[touchTarget ? 2 : 1];

  const actionNodes = actions.map((item) => {
    if (item.key === "new") {
      return (
        <SidebarNewMenu
          key={item.key}
          onAddProject={handleOpenProject}
          onImportSession={handleImportSession}
        />
      );
    }
    if (item.key === "search") {
      return <FooterSearchField key={item.key} theme={theme} />;
    }
    return (
      <FooterIconButton
        key={item.key}
        onPress={handleOpenProject}
        label={labels.addProject}
        shortcutKeys={newAgentKeys}
        icon={FolderPlus}
        testID="sidebar-add-project"
      />
    );
  });
  const controlNodes = [
    ...items
      .filter((item) => item.visible && item.group === "controls")
      .map((item) => {
        if (item.key === "hosts") {
          return (
            <SidebarHostPicker
              key={item.key}
              label={labels.hosts}
              onAddHost={handleAddHost}
              onOpenHostSettings={handleOpenHostSettings}
            />
          );
        }
        if (item.key === "usage-icon") {
          return <SidebarUsageIcon key={item.key} label={labels.usage} />;
        }
        return (
          <FooterIconButton
            key={item.key}
            onPress={handleImportSession}
            testID="sidebar-import-session"
            label={labels.importSession}
            icon={Import}
          />
        );
      }),
    <SidebarHelpMenu key="help" />,
    <FooterIconButton
      key="settings"
      onPress={handleSettings}
      testID="sidebar-settings"
      label={labels.settings}
      icon={Settings}
      shortcutKeys={settingsKeys}
    />,
  ];
  // A phone mirrors the line so New lands under the thumb at the right edge: Settings, Help,
  // Hosts, Usage, then Search and New. Desktop keeps actions left, controls right.
  const actionsGroup = (
    <View style={styles.footerActions(actionMinWidth, touchTarget)}>
      {compact ? actionNodes.toReversed() : actionNodes}
    </View>
  );
  const controlsGroup = (
    <View style={[styles.footerIconRow, compact && styles.footerIconRowCompact]}>
      {compact ? controlNodes.toReversed() : controlNodes}
    </View>
  );

  // Footer rows (Usage, plugins) above the bottom bar.
  return (
    <UsageSidebarRoot>
      <View style={styles.footerContainer} testID="sidebar-footer">
        <SidebarFooterRows onBeforeNavigate={onBeforeNavigate} />
        <View
          style={[styles.sidebarFooter, compact && styles.sidebarFooterCompact]}
          testID="sidebar-footer-bottom-line"
        >
          {compact ? (
            <>
              {controlsGroup}
              {actionsGroup}
            </>
          ) : (
            <>
              {actionsGroup}
              {controlsGroup}
            </>
          )}
        </View>
      </View>
    </UsageSidebarRoot>
  );
}

function SidebarUsageIcon({ label }: { label: string }) {
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

/**
 * The footer rows in the user's `sidebarFooterItems` order: the Usage item and plugin rows. The
 * Usage item is left out while it has no summary to show.
 */
function SidebarFooterRows({ onBeforeNavigate }: { onBeforeNavigate?: () => void }) {
  const { items } = useSidebarNavItems("footer");
  const hasUsageSummary = useHasUsageSummary();
  const rowsRef = useRef<View | null>(null);
  const visibleItems = items.filter(
    (item) => item.visible && (item.kind === "plugin" || hasUsageSummary),
  );
  if (visibleItems.length === 0) return null;
  return (
    <>
      <View ref={rowsRef} collapsable={false} style={styles.footerRows}>
        {visibleItems.map((item) =>
          item.kind === "plugin" ? (
            <PluginSidebarItem
              key={item.key}
              group={item.group}
              section="footer"
              fallbackAnchorRef={rowsRef}
              onBeforeNavigate={onBeforeNavigate}
            />
          ) : (
            <UsageSidebarItem key={item.key} />
          ),
        )}
      </View>
      <SidebarSeparator testID="sidebar-footer-separator" />
    </>
  );
}

function MobileSidebar({
  active,
  theme,
  workspaceGroups,
  projectIconTargets,
  pinnedGroups,
  projects,
  hasProjectsBeforeFilter,
  hasActiveProjectFilter,
  workspaceEntriesByKey,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  groupMode,
  collapsedProjectKeys,
  shortcutIndexByWorkspaceKey,
  toggleProjectCollapsed,
  handleRefresh,
  handleOpenProject,
  handleImportSession,
  handleSettings,
  labels,
  handleAddHost,
  handleOpenHostSettings,
  insetsTop,
  insetsBottom,
  closeSidebar,
}: MobileSidebarProps) {
  const handleConversationPress = useCallback(() => {
    if (HOME_V2_ENABLED) rememberChatReturn("/chat");
    closeSidebar();
  }, [closeSidebar]);
  // On a phone the navigation rows scroll with the list; only the account row stays pinned.
  const botsAndChatsSections = useMemo(
    () => (
      <>
        <SidebarNavRows
          style={styles.mobileNavRows}
          omitTabDestinations={HOME_V2_ENABLED}
          onBeforeNavigate={closeSidebar}
        />
        <BotsAndChatsSidebarSections onBeforeNavigate={handleConversationPress} />
        <QuickChatsSection onBeforeNavigate={handleConversationPress} />
      </>
    ),
    [closeSidebar, handleConversationPress],
  );
  const hasActiveHostFilter = useSidebarViewStore((state) => state.hostFilters.length > 0);
  // Home V2 makes this the Chat tab's page: no close gesture, no X, and the tab bar below it owns
  // the bottom safe area.
  const { gesture: closeGesture, gestureRef: closeGestureRef } =
    useCloseAgentListGesture(!HOME_V2_ENABLED);

  const handleWorkspacePress = handleConversationPress;

  const mobileSidebarInsetStyle = useMemo(
    () => ({
      paddingTop: insetsTop,
      paddingBottom: HOME_V2_ENABLED ? 0 : insetsBottom,
      backgroundColor: theme.colors.surfaceSidebar,
    }),
    [insetsTop, insetsBottom, theme.colors.surfaceSidebar],
  );

  return (
    <MobilePanelOverlay
      panel="agent-list"
      closeGesture={closeGesture}
      panelStyle={mobileSidebarInsetStyle}
    >
      <View style={styles.sidebarContent} pointerEvents="auto">
        <WindowChromeSafeArea placement="below" />
        <SidebarNavGroup
          style={styles.sidebarHeaderGroup}
          rows={false}
          onBeforeNavigate={closeSidebar}
        />
        {HOME_V2_ENABLED ? null : (
          <WindowChromeSafeArea
            pointerEvents="box-none"
            placement="inline"
            style={styles.mobileCloseButtonRow}
          >
            <Pressable
              style={styles.mobileCloseButton}
              onPress={closeSidebar}
              testID="sidebar-close"
              nativeID="sidebar-close"
              accessible
              accessibilityRole="button"
              accessibilityLabel={labels.closeSidebar}
              hitSlop={8}
            >
              {({ hovered, pressed }) => (
                <X
                  size={theme.iconSize.md}
                  color={
                    hovered || pressed ? theme.colors.foreground : theme.colors.foregroundMuted
                  }
                />
              )}
            </Pressable>
          </WindowChromeSafeArea>
        )}

        <SidebarMetadataNotice />
        {isInitialLoad && !hasActiveHostFilter ? (
          <SidebarAgentListSkeleton />
        ) : (
          <SidebarWorkspaceList
            collapsedProjectKeys={collapsedProjectKeys}
            onToggleProjectCollapsed={toggleProjectCollapsed}
            shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
            groupMode={groupMode}
            workspaceGroups={workspaceGroups}
            projectIconTargets={projectIconTargets}
            pinnedGroups={pinnedGroups}
            projects={projects}
            hasProjectsBeforeFilter={hasProjectsBeforeFilter}
            hasActiveProjectFilter={hasActiveProjectFilter}
            workspaceEntriesByKey={workspaceEntriesByKey}
            isRefreshing={isManualRefresh && isRevalidating}
            onRefresh={handleRefresh}
            onWorkspacePress={handleWorkspacePress}
            onAddProject={handleOpenProject}
            onImportSession={handleImportSession}
            parentGestureRef={closeGestureRef}
            dragGestureHostActive={active}
            listLeadingComponent={botsAndChatsSections}
            listHeaderComponent={workspacesSectionHeaderElement}
          />
        )}

        <SidebarFooter
          handleOpenProject={handleOpenProject}
          handleImportSession={handleImportSession}
          handleSettings={handleSettings}
          labels={labels}
          handleAddHost={handleAddHost}
          handleOpenHostSettings={handleOpenHostSettings}
          onBeforeNavigate={closeSidebar}
        />
      </View>
    </MobilePanelOverlay>
  );
}

function DesktopSidebar({
  theme,
  workspaceGroups,
  projectIconTargets,
  pinnedGroups,
  projects,
  hasProjectsBeforeFilter,
  hasActiveProjectFilter,
  workspaceEntriesByKey,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  groupMode,
  collapsedProjectKeys,
  shortcutIndexByWorkspaceKey,
  toggleProjectCollapsed,
  handleRefresh,
  handleOpenProject,
  handleImportSession,
  handleSettings,
  labels,
  handleAddHost,
  handleOpenHostSettings,
  insetsTop,
  active,
}: DesktopSidebarProps) {
  const ownsTopLeft = useOwnsWindowChromeCorner("top-left");
  const hasActiveHostFilter = useSidebarViewStore((state) => state.hostFilters.length > 0);
  const sidebarWidth = usePanelStore((state) => state.sidebarWidth);
  const setSidebarWidth = usePanelStore((state) => state.setSidebarWidth);
  const { width: viewportWidth } = useWindowDimensions();
  const visibleSidebarWidth = resolveDesktopSidebarWidth({
    requestedWidth: sidebarWidth,
    viewportWidth,
  });

  const startWidthRef = useRef(visibleSidebarWidth);
  const resizeWidth = useSharedValue(visibleSidebarWidth);
  const [resizePressed, setResizePressed] = useState(false);
  const showResizeGrip = useCallback(() => setResizePressed(true), []);
  const hideResizeGrip = useCallback(() => setResizePressed(false), []);

  useEffect(() => {
    resizeWidth.value = visibleSidebarWidth;
  }, [resizeWidth, visibleSidebarWidth]);

  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onBegin(() => {
          scheduleOnRN(showResizeGrip);
        })
        // Horizontal intent only, so a finger dragging down the touch grip scrolls
        // the workspace list instead of resizing. Anchoring the start width to the
        // activation translation keeps the extra threshold from jumping the edge.
        .activeOffsetX([-SIDEBAR_RESIZE_ACTIVATION_OFFSET, SIDEBAR_RESIZE_ACTIVATION_OFFSET])
        .failOffsetY([-SIDEBAR_RESIZE_FAIL_OFFSET, SIDEBAR_RESIZE_FAIL_OFFSET])
        .onStart((event) => {
          startWidthRef.current = visibleSidebarWidth - event.translationX;
          resizeWidth.value = visibleSidebarWidth;
        })
        .onUpdate((event) => {
          // Dragging right (positive translationX) increases width
          const newWidth = startWidthRef.current + event.translationX;
          resizeWidth.value = resolveDesktopSidebarWidth({
            requestedWidth: newWidth,
            viewportWidth,
          });
        })
        .onEnd(() => {
          runOnJS(setSidebarWidth)(resizeWidth.value);
        })
        .onFinalize(() => {
          scheduleOnRN(hideResizeGrip);
        }),
    [
      hideResizeGrip,
      resizeWidth,
      setSidebarWidth,
      showResizeGrip,
      viewportWidth,
      visibleSidebarWidth,
    ],
  );

  const resizeAnimatedStyle = useAnimatedStyle(() => ({
    width: resizeWidth.value,
  }));

  const desktopSidebarStyle = useMemo(
    () => [
      staticStyles.desktopSidebar,
      !active && staticStyles.desktopSidebarHidden,
      resizeAnimatedStyle,
    ],
    [active, resizeAnimatedStyle],
  );
  const desktopSidebarBorderStyle = useMemo(
    () => [styles.desktopSidebarBorder, { flex: 1, paddingTop: insetsTop }],
    [insetsTop],
  );
  const sidebarHeaderGroupStyle = useMemo(
    () => [styles.sidebarHeaderGroup, ownsTopLeft && styles.sidebarHeaderGroupBelowChrome],
    [ownsTopLeft],
  );
  return (
    <Animated.View
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      pointerEvents={active ? "auto" : "none"}
      style={desktopSidebarStyle}
    >
      <View style={desktopSidebarBorderStyle}>
        <View style={styles.sidebarDragArea}>
          {ownsTopLeft || DEV_BUILD_LABEL ? (
            <View style={styles.desktopChromeRow}>
              <TitlebarDragRegion />
              {DEV_BUILD_LABEL ? (
                <View
                  pointerEvents="none"
                  style={styles.devBuildBadge}
                  testID="dev-build-label"
                  accessibilityLabel={`Development build: ${DEV_BUILD_LABEL}`}
                >
                  <GitBranch size={12} color={theme.colors.accentForeground} />
                  <Text numberOfLines={1} ellipsizeMode="tail" style={styles.devBuildBadgeText}>
                    {DEV_BUILD_LABEL}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : (
            <TitlebarDragRegion />
          )}
          <SidebarNavGroup style={sidebarHeaderGroupStyle} />
        </View>

        <SidebarMetadataNotice />
        {isInitialLoad && !hasActiveHostFilter ? (
          <SidebarAgentListSkeleton />
        ) : (
          <SidebarWorkspaceList
            collapsedProjectKeys={collapsedProjectKeys}
            onToggleProjectCollapsed={toggleProjectCollapsed}
            shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
            groupMode={groupMode}
            workspaceGroups={workspaceGroups}
            projectIconTargets={projectIconTargets}
            pinnedGroups={pinnedGroups}
            projects={projects}
            hasProjectsBeforeFilter={hasProjectsBeforeFilter}
            hasActiveProjectFilter={hasActiveProjectFilter}
            workspaceEntriesByKey={workspaceEntriesByKey}
            isRefreshing={isManualRefresh && isRevalidating}
            onRefresh={handleRefresh}
            onAddProject={handleOpenProject}
            onImportSession={handleImportSession}
            listLeadingComponent={botsAndChatsSectionsElement}
            listHeaderComponent={workspacesSectionHeaderElement}
          />
        )}

        <SidebarCalloutSlot />

        <SidebarFooter
          handleOpenProject={handleOpenProject}
          handleImportSession={handleImportSession}
          handleSettings={handleSettings}
          labels={labels}
          handleAddHost={handleAddHost}
          handleOpenHostSettings={handleOpenHostSettings}
        />

        <SidebarResizeHandle
          edge="right"
          gesture={resizeGesture}
          pressed={resizePressed}
          testID="left-sidebar-resize-handle"
        />
      </View>
    </Animated.View>
  );
}

function WorkspacesSectionHeader() {
  const fusion = useBotsFeatureHosts().length > 0;
  const openProjectPicker = useOpenAddProject();
  const compact = useIsCompactFormFactor();
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const addProject = useCallback(() => {
    if (compact) showMobileAgent();
    void openProjectPicker();
  }, [compact, showMobileAgent, openProjectPicker]);
  const [collapsed, toggle] = useSectionCollapsed("projects");
  if (fusion)
    return (
      <View>
        <BotsSectionHeader
          label="Projects"
          onCreate={addProject}
          createLabel="Add project"
          testID="sidebar-projects-header"
          collapsed={collapsed}
          onToggle={toggle}
          actions={displayPreferencesMenuElement}
        />
        {collapsed ? null : <SidebarViewBar />}
        <SidebarActiveFilters />
      </View>
    );
  return (
    <View style={styles.workspacesSectionHeader}>
      <View style={styles.workspacesSectionTitleRow}>
        <Text style={styles.workspacesSectionTitle}>Workspaces</Text>
        <View style={styles.workspacesSectionActions}>
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <View>
                <SidebarDisplayPreferencesMenu />
              </View>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center" offset={8}>
              <IconTooltipContent label="Display preferences" />
            </TooltipContent>
          </Tooltip>
        </View>
      </View>
      <SidebarActiveFilters />
    </View>
  );
}

// Stable element so the sidebar list's listHeaderComponent prop keeps identity across
// renders (WorkspacesSectionHeader takes no props).
const workspacesSectionHeaderElement = <WorkspacesSectionHeader />;

// Static styles for Animated.Views — must NOT use Unistyles dynamic theme to
// avoid the "Unable to find node on an unmounted component" crash when Unistyles
// tries to patch the native node that Reanimated also manages.
const staticStyles = RNStyleSheet.create({
  desktopSidebar: {
    position: "relative" as const,
  },
  desktopSidebarHidden: {
    display: "none",
  },
});

const styles = StyleSheet.create((theme) => ({
  sidebarHeaderGroup: {
    paddingTop: theme.spacing[2],
    gap: 2,
    paddingBottom: theme.spacing[1.5],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  sidebarHeaderGroupBelowChrome: {
    paddingTop: 0,
  },
  // The header group's rows, moved into the list: undo the list's inset, keep the divider below.
  mobileNavRows: {
    marginHorizontal: -theme.spacing[2],
    gap: 2,
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1.5],
    marginBottom: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  workspacesSectionHeader: {
    gap: theme.spacing[1],
    // Rendered inside the scroll's listContent (paddingHorizontal spacing[2]). The title
    // lands at spacing[2] left to align with project icons. Settings2's painted path stops
    // inside its 14px SVG, so 4px aligns the ink rather than the SVG box to the row rail.
    paddingLeft: theme.spacing[2],
    paddingRight: 4,
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1],
  },
  workspacesSectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  workspacesSectionTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  workspacesSectionActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  sidebarContent: {
    flex: 1,
    minHeight: 0,
  },
  mobileCloseButtonRow: {
    position: "absolute",
    top: theme.spacing[3],
    left: 0,
    right: 0,
    zIndex: 2,
    alignItems: "flex-end",
  },
  mobileCloseButton: {
    // The 16px X paints farther inside its 32px hit target than the 14px Settings2 glyph.
    // This optical inset puts their painted right edges on the same sidebar rail.
    marginRight: theme.spacing[2] + 1.5,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  desktopSidebarBorder: {
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  sidebarDragArea: {
    position: "relative",
  },
  desktopChromeRow: {
    position: "relative",
    height: HEADER_INNER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: "transparent",
  },
  devBuildBadge: {
    maxWidth: "60%",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  devBuildBadgeText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.accentForeground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  footerContainer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  sidebarFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[3],
  },
  sidebarFooterCompact: {
    flexWrap: "nowrap",
  },
  footerIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
    marginLeft: "auto",
  },
  // Touch targets are already 48pt wide; their glyphs need no extra gap. The row leads the line.
  footerIconRowCompact: {
    gap: 0,
    marginLeft: 0,
  },
  footerActions: (minWidth: number, touchTarget: boolean) => ({
    flex: 1,
    minWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[touchTarget ? 2 : 1],
  }),
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
  // Usage and plugin rows sit above the footer's icon line, spaced like the header nav rows.
  footerRows: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    gap: 2,
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

const botsAndChatsSectionsElement = (
  <>
    <BotsAndChatsSidebarSections />
    <QuickChatsSection />
  </>
);

const displayPreferencesMenuElement = <SidebarDisplayPreferencesMenu />;
