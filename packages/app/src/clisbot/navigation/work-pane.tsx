import { memo, useCallback, useMemo, useState, type MutableRefObject } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { FolderPlus, Import, Plus } from "lucide-react-native";
import type { GestureType } from "react-native-gesture-handler";
import { SidebarViewBar } from "@/clisbot/workspace-sessions/view-bar";
import type { ChatListAdmission } from "@/clisbot/home/use-chat-list-navigation";
import { SidebarAgentListSkeleton } from "@/components/sidebar-agent-list-skeleton";
import { SidebarWorkspaceList } from "@/components/sidebar-workspace-list";
import { SidebarActiveFilters } from "@/components/sidebar/display-preferences/active-filters";
import { SidebarDisplayPreferencesMenu } from "@/components/sidebar/display-preferences/menu";
import { SidebarMetadataNotice } from "@/components/sidebar/empty-states";
import { RetainedSidebarModel, useSidebarModel } from "@/components/sidebar/sidebar-model";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { FilterChip } from "@/components/ui/filter-chips";
import { Shortcut } from "@/components/ui/shortcut";
import { useImportSession } from "@/hooks/use-import-session";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useOpenNewWorkspace } from "@/hooks/use-open-new-workspace";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { RenderProfile } from "@/utils/render-profiler";
import { useHostsReachability } from "./hosts-status";
import { HostsUnreachableState } from "./hosts-unreachable-state";
import { OutsideFilterNotice } from "./outside-filter-notice";
import { EMPTY_SCOPE_COUNTS } from "./ownership";
import { ScrollEdgeLine, ScrollEdgeProvider, useScrollEdge } from "./scroll-edge";
import { SectionControls, SectionPinnedChips, useSectionBackdrop } from "./section-controls";
import {
  HeaderMenuButton,
  HeaderMenuIcon,
  HeaderSearchButton,
  SECTION_MENU_WIDTH,
  SectionHeader,
} from "./section-header";
import { useNavigationStore, type WorkChip } from "./store";
import { useWorkQuery, WORK_CHIPS } from "./work-filter";
import { createWorkCounter } from "./work-items";

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
export const WorkPane = memo(function WorkPane(props: WorkPaneProps) {
  return (
    <RetainedSidebarModel>
      <WorkPaneContent {...props} />
    </RetainedSidebarModel>
  );
});

interface WorkPaneProps {
  onBeforeNavigate?: ChatListAdmission;
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
  active?: boolean;
}

function WorkPaneContent({ onBeforeNavigate, parentGestureRef, active }: WorkPaneProps) {
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
  const workState = useWorkListState(model, hasActiveHostFilter);
  const edge = useScrollEdge();
  // A phone's list keeps the screen: only the title stays, the controls scroll away with the rows.
  const compact = useIsCompactFormFactor();
  const controlsScroll = compact && workState === "list";
  const controls = useWorkControls();
  const controlsBlock = useMemo(
    () => (
      <>
        <WorkControls state={controls} chipsPinned={compact} />
        <OutsideFilterNotice list="work" />
        <SidebarMetadataNotice />
      </>
    ),
    [compact, controls],
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
    <RenderProfile id="NavWork">
      <View style={styles.pane} testID="work-pane">
        <SectionHeader title={t("navigation.sections.work")} actions={headerActions} />
        {compact ? (
          <SectionPinnedChips
            section="work"
            chips={controls.chips}
            chip={controls.chip}
            onChip={controls.setChip}
            backdrop={controls.backdrop}
            display={displayMenu}
          />
        ) : null}
        {controlsScroll ? null : controlsBlock}
        {workState === "offline" ? <HostsUnreachableState testID="work-offline" /> : null}
        {workState === "loading" ? <SidebarAgentListSkeleton /> : null}
        <ScrollEdgeLine edge={edge} onPhones />
        {workState === "list" ? (
          <ScrollEdgeProvider edge={edge}>
            <SidebarWorkspaceList
              listTopComponent={controlsScroll ? controlsBlock : null}
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
            />
          </ScrollEdgeProvider>
        ) : null}
        {importSession.sheet}
      </View>
    </RenderProfile>
  );
}

/**
 * What Work shows in place of its list: the skeleton while the first Host connects or its
 * directory loads, a word when no Host can be reached, otherwise the list itself.
 */
function useWorkListState(
  model: ReturnType<typeof useSidebarModel>,
  hasActiveHostFilter: boolean,
): "loading" | "offline" | "list" {
  const reach = useHostsReachability();
  const nothing = !model.hasProjectsBeforeFilter;
  if (nothing && reach === "unreachable") return "offline";
  if (hasActiveHostFilter) return "list";
  if (model.isInitialLoad || (nothing && reach === "connecting")) return "loading";
  return "list";
}

/** Work's search widens to everything: the Command Center, which ⌘K also opens. */
function useOpenSearch() {
  const setOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  return useCallback(() => setOpen(true), [setOpen]);
}

const EMPTY_COUNTS = {
  chips: { all: 0, needs: 0, running: 0, done: 0, failed: 0 },
  scopes: EMPTY_SCOPE_COUNTS,
};

function useWorkControls() {
  const { t } = useTranslation();
  const { allWorkspaceEntriesByKey, workList } = useSidebarModel();
  const query = useWorkQuery();
  const setChip = useNavigationStore((state) => state.setWorkChip);
  const backdrop = useSectionBackdrop();
  // Once per change of the entries, the sessions or the query; the same items the list shows.
  const countWork = useMemo(createWorkCounter, []);
  const counts = useMemo(
    () =>
      workList
        ? countWork(allWorkspaceEntriesByKey.values(), workList.sessionsOf, query)
        : EMPTY_COUNTS,
    [allWorkspaceEntriesByKey, workList, query, countWork],
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
  return { chips, chip: query.chip, setChip, backdrop, scopeCounts: counts.scopes };
}

type WorkControlsState = ReturnType<typeof useWorkControls>;

function WorkControls({ state, chipsPinned }: { state: WorkControlsState; chipsPinned: boolean }) {
  return (
    <SectionControls
      section="work"
      scopeCounts={state.scopeCounts}
      chips={state.chips}
      chip={state.chip}
      onChip={state.setChip}
      backdrop={state.backdrop}
      display={displayMenu}
      chipsPinned={chipsPinned}
    >
      <SidebarViewBar />
      <SidebarActiveFilters />
    </SectionControls>
  );
}

const displayMenu = <SidebarDisplayPreferencesMenu trigger="label" />;

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
      <HeaderMenuButton Icon={Plus} label={t("navigation.actions.new")} testID="work-new" />
      <DropdownMenuContent
        align="end"
        width={SECTION_MENU_WIDTH}
        sheetTitle={t("navigation.actions.new")}
      >
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

const styles = StyleSheet.create({
  pane: { flex: 1, minHeight: 0 },
});
