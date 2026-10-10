import { HOME_V2_ENABLED } from "@/clisbot/home/feature";
import { useHubAccount } from "@/clisbot/hub/account-provider";
import { useBotsFeatureHosts } from "@/clisbot/bots/feature";
import { ConnectorsSidebarItem } from "@/clisbot/connectors/connectors-sidebar-item";
import { router, usePathname } from "expo-router";
import { CalendarClock, FolderPlus, History, Home, Inbox, Plus, Search } from "lucide-react-native";
import { memo, useCallback, useMemo, useRef, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useOpenNewWorkspace } from "@/hooks/use-open-new-workspace";
import { PluginSidebarItem } from "@/plugins/sidebar-items";
import {
  builtinSidebarNavLabelKey,
  builtinSidebarNavShortcutAction,
  type BuiltinSidebarNavId,
} from "@/sidebar-nav/model";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { buildSchedulesRoute, buildSessionsRoute } from "@/utils/host-routes";

interface SidebarNavRowProps {
  onBeforeNavigate?: () => void;
}

interface SidebarNavRowsProps extends SidebarNavRowProps {
  /** Style for the group wrapper, which the sidebar owns. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Top-level sidebar navigation, ordered and filtered by the user's
 * `sidebarNavItems` preference. Renders nothing — not even the bordered group
 * wrapper — when every item is hidden.
 */
export function SidebarNavRows({ style, onBeforeNavigate }: SidebarNavRowsProps) {
  const { items } = useSidebarNavItems("header");
  const visibleItems = useMemo(() => items.filter((item) => item.visible), [items]);
  const groupRef = useRef<View | null>(null);

  if (visibleItems.length === 0 && !HOME_V2_ENABLED)
    return <ConnectorsSidebarItem groupStyle={style} onBeforeNavigate={onBeforeNavigate} />;

  return (
    <View ref={groupRef} collapsable={false} style={style}>
      {HOME_V2_ENABLED ? <SidebarHomeRow onBeforeNavigate={onBeforeNavigate} /> : null}
      {visibleItems.map((item) => {
        if (item.kind === "plugin") {
          return (
            <PluginSidebarItem
              key={item.key}
              group={item.group}
              section="header"
              fallbackAnchorRef={groupRef}
              onBeforeNavigate={onBeforeNavigate}
            />
          );
        }
        const Row = BUILTIN_ROWS[item.id];
        return <Row key={item.key} onBeforeNavigate={onBeforeNavigate} />;
      })}
      <ConnectorsSidebarItem onBeforeNavigate={onBeforeNavigate} />
    </View>
  );
}

/** Home V2 leads the navigation with Home, a destination like Inbox rather than the brand row. */
function SidebarHomeRow({ onBeforeNavigate }: SidebarNavRowProps) {
  const pathname = usePathname();
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.navigate("/open-project");
  }, [onBeforeNavigate]);
  return (
    <SidebarHeaderRow
      icon={Home}
      label="Home"
      onPress={handlePress}
      isActive={pathname === "/open-project"}
      testID="sidebar-home"
      variant="compact"
    />
  );
}

const SidebarNewWorkspaceRow = memo(function SidebarNewWorkspaceRow({
  onBeforeNavigate,
}: SidebarNavRowProps) {
  const { t } = useTranslation();
  const shortcutKeys = useShortcutKeys(builtinSidebarNavShortcutAction("new-workspace"));
  const handlePress = useOpenNewWorkspace(onBeforeNavigate);

  return (
    <SidebarHeaderRow
      icon={Plus}
      label={t(builtinSidebarNavLabelKey("new-workspace"))}
      onPress={handlePress}
      testID="sidebar-global-new-workspace"
      variant="compact"
      shortcutKeys={shortcutKeys}
    />
  );
});

function SidebarAddProjectRow({ onBeforeNavigate }: SidebarNavRowProps) {
  const { t } = useTranslation();
  const openAddProject = useOpenAddProject();
  const shortcutKeys = useShortcutKeys(builtinSidebarNavShortcutAction("add-project"));
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    void openAddProject();
  }, [onBeforeNavigate, openAddProject]);
  return (
    <SidebarHeaderRow
      icon={FolderPlus}
      label={t(builtinSidebarNavLabelKey("add-project"))}
      onPress={handlePress}
      testID="sidebar-nav-add-project"
      variant="compact"
      shortcutKeys={shortcutKeys}
    />
  );
}

function SidebarHistoryRow({ onBeforeNavigate }: SidebarNavRowProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(buildSessionsRoute());
  }, [onBeforeNavigate]);

  return (
    <SidebarHeaderRow
      icon={HOME_V2_ENABLED ? Inbox : History}
      label={HOME_V2_ENABLED ? "Inbox" : t(builtinSidebarNavLabelKey("history"))}
      onPress={handlePress}
      isActive={pathname.includes("/sessions")}
      testID="sidebar-sessions"
      variant="compact"
    />
  );
}

function SidebarSearchRow({ onBeforeNavigate }: SidebarNavRowProps) {
  const { t } = useTranslation();
  const shortcutKeys = useShortcutKeys(builtinSidebarNavShortcutAction("search"));
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    setCommandCenterOpen(true);
  }, [onBeforeNavigate, setCommandCenterOpen]);

  return (
    <SidebarHeaderRow
      icon={Search}
      label={t(builtinSidebarNavLabelKey("search"))}
      onPress={handlePress}
      testID="sidebar-search"
      variant="compact"
      shortcutKeys={shortcutKeys}
    />
  );
}

function SidebarSchedulesRow({ onBeforeNavigate }: SidebarNavRowProps) {
  const hub = useHubAccount();
  const botsEnabled = useBotsFeatureHosts().length > 0;
  const { t } = useTranslation();
  const pathname = usePathname();
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(buildSchedulesRoute());
  }, [onBeforeNavigate]);

  return (
    <SidebarHeaderRow
      icon={CalendarClock}
      label={hub.enabled || botsEnabled ? "Automations" : t(builtinSidebarNavLabelKey("schedules"))}
      onPress={handlePress}
      isActive={pathname.includes("/schedules")}
      testID="sidebar-schedules"
      variant="compact"
    />
  );
}

const BUILTIN_ROWS: Record<BuiltinSidebarNavId, ComponentType<SidebarNavRowProps>> = {
  "new-workspace": SidebarNewWorkspaceRow,
  "add-project": SidebarAddProjectRow,
  history: SidebarHistoryRow,
  search: SidebarSearchRow,
  schedules: SidebarSchedulesRow,
};
