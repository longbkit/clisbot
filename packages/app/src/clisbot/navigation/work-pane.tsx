import { useCallback, useMemo, useState, type MutableRefObject } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { FolderPlus, Import, Plus } from "lucide-react-native";
import type { GestureType } from "react-native-gesture-handler";
import { QuickChatsSection } from "@/clisbot/quick-chats/quick-chats-section";
import { SidebarViewBar } from "@/clisbot/workspace-sessions/view-bar";
import type { ChatListAdmission } from "@/clisbot/home/use-chat-list-navigation";
import { SidebarAgentListSkeleton } from "@/components/sidebar-agent-list-skeleton";
import { SidebarWorkspaceList } from "@/components/sidebar-workspace-list";
import { SidebarActiveFilters } from "@/components/sidebar/display-preferences/active-filters";
import { SidebarDisplayPreferencesMenu } from "@/components/sidebar/display-preferences/menu";
import { SidebarMetadataNotice } from "@/components/sidebar/empty-states";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { FilterChips, type FilterChip } from "@/components/ui/filter-chips";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { Shortcut } from "@/components/ui/shortcut";
import { useImportSession } from "@/hooks/use-import-session";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useOpenNewWorkspace } from "@/hooks/use-open-new-workspace";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useReaderAccounts } from "./reader";
import { ScopeTabs } from "./scope-tabs";
import { HeaderMenuIcon, HeaderSearchButton, SectionHeader } from "./section-header";
import { useNavigationStore, type WorkChip } from "./store";
import { countWork, WORK_CHIPS } from "./work-filter";

const CHIP_LABELS: Record<WorkChip, string> = {
  all: "navigation.chips.all",
  needs: "navigation.chips.needs",
  running: "navigation.chips.running",
  done: "navigation.chips.done",
  failed: "navigation.chips.failed",
};

/**
 * Work (brief C4): work sessions only, project → workspace → session as before, pinned work on
 * top with a pin mark. The display menu, grouping tabs and active filters are the sidebar's own.
 */
export function WorkPane({
  onBeforeNavigate,
  parentGestureRef,
  active,
}: {
  onBeforeNavigate?: ChatListAdmission;
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
  active?: boolean;
}) {
  const { t } = useTranslation();
  const model = useSidebarModel();
  const openSearch = useOpenSearch();
  const importSession = useImportSession({});
  const addProject = useOpenAddProject();
  const openAddProject = useCallback(() => void addProject(), [addProject]);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(() => {
    setRefreshing(true);
    model.refreshAll();
    setTimeout(() => setRefreshing(false), 600);
  }, [model]);
  const hasActiveHostFilter = useSidebarViewStore((state) => state.hostFilters.length > 0);
  const leading = useMemo(
    () => <QuickChatsSection onBeforeNavigate={onBeforeNavigate} />,
    [onBeforeNavigate],
  );
  const headerActions = useMemo(
    () => (
      <>
        <HeaderSearchButton onPress={openSearch} testID="work-search" />
        <NewWorkMenu
          onBeforeNavigate={onBeforeNavigate}
          onAddProject={openAddProject}
          onImportSession={importSession.open}
        />
      </>
    ),
    [importSession.open, onBeforeNavigate, openAddProject, openSearch],
  );
  return (
    <View style={styles.pane} testID="work-pane">
      <SectionHeader title={t("navigation.sections.work")} actions={headerActions} />
      <WorkControls />
      <SidebarMetadataNotice />
      {model.isInitialLoad && !hasActiveHostFilter ? (
        <SidebarAgentListSkeleton />
      ) : (
        <SidebarWorkspaceList
          pinPresentation="float"
          collapsedProjectKeys={model.collapsedProjectKeys}
          onToggleProjectCollapsed={model.toggleProjectCollapsed}
          shortcutIndexByWorkspaceKey={model.shortcutModel.shortcutIndexByWorkspaceKey}
          groupMode={model.groupMode}
          workspaceGroups={model.workspaceGroups}
          projectIconTargets={model.projectIconTargets}
          pinnedGroups={model.pinnedGroups}
          projects={model.projects}
          hasProjectsBeforeFilter={model.hasProjectsBeforeFilter}
          hasActiveProjectFilter={model.resolvedProjectFilters.length > 0}
          workspaceEntriesByKey={model.workspaceEntriesByKey}
          isRefreshing={refreshing}
          onRefresh={refresh}
          onWorkspacePress={onBeforeNavigate}
          onAddProject={openAddProject}
          onImportSession={importSession.open}
          parentGestureRef={parentGestureRef}
          dragGestureHostActive={active}
          listLeadingComponent={leading}
        />
      )}
      {importSession.sheet}
    </View>
  );
}

/** Work's search widens to everything: the Command Center, which ⌘K also opens. */
function useOpenSearch() {
  const setOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  return useCallback(() => setOpen(true), [setOpen]);
}

function WorkControls() {
  const { t } = useTranslation();
  const { allWorkspaceEntriesByKey } = useSidebarModel();
  const scope = useNavigationStore((state) => state.scopes.work);
  const chip = useNavigationStore((state) => state.workChip);
  const setChip = useNavigationStore((state) => state.setWorkChip);
  const accounts = useReaderAccounts();
  const counts = useMemo(
    () => countWork(allWorkspaceEntriesByKey.values(), scope, accounts),
    [allWorkspaceEntriesByKey, scope, accounts],
  );
  const chips = useMemo<FilterChip<WorkChip>[]>(
    () =>
      WORK_CHIPS.map((value) => ({
        value,
        label: t(CHIP_LABELS[value]),
        count: value === "all" ? undefined : counts.chips[value],
      })),
    [counts, t],
  );
  return (
    <View style={styles.controls}>
      <ScopeTabs section="work" counts={counts.scopes} />
      <View style={styles.inset}>
        <FilterChips chips={chips} value={chip} onChange={setChip} scroll testID="work-chip" />
      </View>
      <View style={styles.display}>
        <Text style={styles.displayLabel}>{t("navigation.display")}</Text>
        <SidebarDisplayPreferencesMenu />
      </View>
      <SidebarViewBar />
      <SidebarActiveFilters />
    </View>
  );
}

/** +: New workspace, Add project, Import session (brief 3.1a). */
function NewWorkMenu({
  onBeforeNavigate,
  onAddProject,
  onImportSession,
}: {
  onBeforeNavigate?: ChatListAdmission;
  onAddProject: () => void;
  onImportSession: () => void;
}) {
  const { t } = useTranslation();
  const close = useCallback(() => void onBeforeNavigate?.(), [onBeforeNavigate]);
  const openWorkspace = useOpenNewWorkspace(close);
  const workspaceKeys = useShortcutKeys("new-workspace");
  const projectKeys = useShortcutKeys("new-agent");
  const workspaceShortcut = useMemo(
    () => (workspaceKeys ? <Shortcut chord={workspaceKeys} /> : null),
    [workspaceKeys],
  );
  const projectShortcut = useMemo(
    () => (projectKeys ? <Shortcut chord={projectKeys} /> : null),
    [projectKeys],
  );
  return (
    <DropdownMenu>
      <ToolbarButton kind="menu" label={t("navigation.actions.new")} testID="work-new">
        <HeaderMenuIcon Icon={Plus} />
      </ToolbarButton>
      <DropdownMenuContent align="end" width={240} sheetTitle={t("navigation.actions.new")}>
        <DropdownMenuItem
          leading={plusIcon}
          trailing={workspaceShortcut}
          onSelect={openWorkspace}
          testID="work-new-workspace"
        >
          {t("navigation.actions.newWorkspace")}
        </DropdownMenuItem>
        <DropdownMenuItem
          leading={folderIcon}
          trailing={projectShortcut}
          onSelect={onAddProject}
          testID="work-new-project"
        >
          {t("navigation.actions.addProject")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          leading={importIcon}
          onSelect={onImportSession}
          testID="work-import-session"
        >
          {t("navigation.actions.importSession")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const plusIcon = <HeaderMenuIcon Icon={Plus} />;
const folderIcon = <HeaderMenuIcon Icon={FolderPlus} />;
const importIcon = <HeaderMenuIcon Icon={Import} />;

const styles = StyleSheet.create((theme) => ({
  pane: { flex: 1, minHeight: 0 },
  controls: { gap: theme.spacing[2], paddingBottom: theme.spacing[1] },
  inset: { paddingHorizontal: theme.spacing[3] },
  display: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
  },
  displayLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
