import { useCallback, useMemo, useState, type ReactElement } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  ChevronUp,
  CircleGauge,
  CircleHelp,
  FolderPlus,
  Server,
  Settings,
} from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { SidebarFooterAction } from "@/components/sidebar-footer-layout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSubTrigger,
  type MenuPageDefinition,
} from "@/components/ui/dropdown-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import {
  type SidebarHostPickerTrigger,
  SidebarHostPicker,
  useOpenFooterSearch,
} from "./sidebar-footer-controls";
import { useOpenSidebarUsage } from "@/usage";
import { SidebarFooterMenuTrigger } from "./sidebar-footer-menu-trigger";
import { SidebarHelpMenuItems } from "./sidebar-help-menu";

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedFolderPlus = withUnistyles(FolderPlus);
const ThemedCircleGauge = withUnistyles(CircleGauge);
const ThemedServer = withUnistyles(Server);
const ThemedCircleHelp = withUnistyles(CircleHelp);
const ThemedSettings = withUnistyles(Settings);
const addProjectLeading = <ThemedFolderPlus size={ICON_SIZE.sm} uniProps={mutedIconMapping} />;
const usageLeading = <ThemedCircleGauge size={ICON_SIZE.sm} uniProps={mutedIconMapping} />;
const hostsLeading = <ThemedServer size={ICON_SIZE.sm} uniProps={mutedIconMapping} />;
const helpLeading = <ThemedCircleHelp size={ICON_SIZE.sm} uniProps={mutedIconMapping} />;
const settingsLeading = <ThemedSettings size={ICON_SIZE.sm} uniProps={mutedIconMapping} />;

const HELP_PAGE_ID = "help";

export interface SidebarFooterOverflowMenuProps {
  /** The footer actions that did not fit in the row, in row order. */
  actions: readonly SidebarFooterAction[];
  labels: { addProject: string; hosts: string; settings: string; usage: string };
  onAddProject: () => void;
  onImportSession: () => void;
  onSettings: () => void;
  onAddHost: () => void;
  onOpenHostSettings: (serverId: string) => void;
}

/**
 * The caret at the end of a footer row too narrow for every action. It lists the actions that
 * lost their place, with the same test IDs they carry in the row. Hosts opens the shared filter and settings picker.
 */
export function SidebarFooterOverflowMenu({
  actions,
  labels,
  onAddProject,
  onImportSession,
  onSettings,
  onAddHost,
  onOpenHostSettings,
}: SidebarFooterOverflowMenuProps): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const openUsage = useOpenSidebarUsage();
  const newAgentKeys = useShortcutKeys("new-agent");
  const settingsKeys = useShortcutKeys("toggle-settings");
  const openSearch = useOpenFooterSearch();
  const helpLabel = t("sidebar.help.trigger");
  const addProjectTrailing = useMemo(
    () => (newAgentKeys ? <Shortcut chord={newAgentKeys} /> : null),
    [newAgentKeys],
  );
  const settingsTrailing = useMemo(
    () => (settingsKeys ? <Shortcut chord={settingsKeys} /> : null),
    [settingsKeys],
  );

  const pages = useMemo((): MenuPageDefinition[] => {
    const result: MenuPageDefinition[] = [];
    if (actions.includes("help")) {
      result.push({ id: HELP_PAGE_ID, title: helpLabel, content: <SidebarHelpMenuItems /> });
    }
    return result;
  }, [actions, helpLabel]);

  const renderAction = useCallback(
    (action: SidebarFooterAction, openHosts: () => void): ReactElement => {
      switch (action) {
        case "search":
          return (
            <DropdownMenuItem key={action} onSelect={openSearch}>
              {t("sidebar.sections.search")}
            </DropdownMenuItem>
          );
        case "import-session":
          return (
            <DropdownMenuItem key={action} onSelect={onImportSession}>
              {t("importSession.title")}
            </DropdownMenuItem>
          );
        case "add-project":
          return (
            <DropdownMenuItem
              key={action}
              testID="sidebar-add-project"
              leading={addProjectLeading}
              trailing={addProjectTrailing}
              onSelect={onAddProject}
            >
              {labels.addProject}
            </DropdownMenuItem>
          );
        case "usage":
          return (
            <DropdownMenuItem
              key={action}
              testID="sidebar-usage-icon"
              leading={usageLeading}
              onSelect={openUsage}
            >
              {labels.usage}
            </DropdownMenuItem>
          );
        case "hosts":
          return (
            <DropdownMenuItem
              key={action}
              onSelect={openHosts}
              testID="sidebar-hosts-trigger"
              leading={hostsLeading}
            >
              {labels.hosts}
            </DropdownMenuItem>
          );
        case "help":
          return (
            <DropdownMenuSubTrigger
              key={action}
              id={HELP_PAGE_ID}
              testID="sidebar-help"
              leading={helpLeading}
            >
              {helpLabel}
            </DropdownMenuSubTrigger>
          );
        case "settings":
          return (
            <DropdownMenuItem
              key={action}
              testID="sidebar-settings"
              leading={settingsLeading}
              trailing={settingsTrailing}
              onSelect={onSettings}
            >
              {labels.settings}
            </DropdownMenuItem>
          );
      }
    },
    [
      openSearch,
      t,
      onImportSession,
      onAddProject,
      addProjectTrailing,
      labels,
      openUsage,
      helpLabel,
      settingsTrailing,
      onSettings,
    ],
  );

  const renderMenu = useCallback(
    ({ ref, onPress: openHosts }: SidebarHostPickerTrigger) => (
      <View ref={ref} collapsable={false}>
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <SidebarFooterMenuTrigger
            icon={ChevronUp}
            label={t("sidebar.actions.moreActions")}
            menuOpen={open}
            testID="sidebar-footer-overflow"
          />
          <DropdownMenuContent
            side="top"
            align="end"
            offset={8}
            width={240}
            pages={pages}
            scrollable
            testID="sidebar-footer-overflow-menu"
          >
            {actions.map((action) => renderAction(action, openHosts))}
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
    ),
    [open, t, pages, actions, renderAction],
  );
  return (
    <SidebarHostPicker
      label={labels.hosts}
      onAddHost={onAddHost}
      onOpenHostSettings={onOpenHostSettings}
      renderTrigger={renderMenu}
    />
  );
}
