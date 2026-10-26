import { useDirectoryHealth } from "./use-directory-health";
import { useSidebarHostIds } from "./use-sidebar-host-ids";
import { projectBotWorkspaces } from "@/clisbot/bot-projects/projection";
import { useShowBotProjects } from "@/clisbot/bot-projects/preferences";
import { useSidebarBotProjectKeys } from "@/clisbot/bots/sidebar/hide-bot-projects";
import {
  mergeQuickChatProjects,
  quickChatProjectKeys,
  useQuickChatRoots,
} from "@/clisbot/quick-chats/quick-chat-projects";
import { NAVIGATION_V2_ENABLED } from "@/clisbot/navigation/feature";
import { useTranslation } from "react-i18next";
import { useHostFeatureMap } from "@/runtime/host-features";
import { useCallback, useEffect, useMemo } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceDirectoryServerIds } from "@/stores/session-store-hooks";
import { workspaceEqualityFns } from "@/stores/session-store-hooks/selectors";
import { useWorkspaceStructure } from "@/stores/session-store-hooks";
import { getHostRuntimeStore, useHostRegistryLoaded, useHosts } from "@/runtime/host-runtime";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import {
  createSidebarWorkspacePlacementSelector,
  computeSidebarOrderUpdates,
  deriveProjectStatusBucket,
  type ProjectStatusSession,
  type SidebarProjectEntry,
  type SidebarWorkspacePlacement,
} from "./sidebar-workspaces-view-model";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export {
  appendMissingOrderKeys,
  applyStoredOrdering,
  buildSidebarProjectsFromHostProjects,
  buildSidebarProjectsFromStructure,
  createSidebarWorkspaceEntry,
  buildSidebarWorkspacePlacementModel,
  computeSidebarOrderUpdates,
  deriveProjectStatusBucket,
  deriveSidebarLoadingState,
  shouldShowSidebarHostLabels,
  type SidebarLoadingState,
  type SidebarOrderUpdates,
  type SidebarStatusWorkspacePlacement,
  type SidebarWorkspaceEntry,
  type SidebarWorkspacePlacement,
  type SidebarWorkspacePlacementModel,
  type SidebarProjectEntry,
  type SidebarStateBucket,
} from "./sidebar-workspaces-view-model";

/**
 * Aggregate status for a project's workspaces, for the collapsed project row.
 *
 * `SidebarProjectEntry` is structural — it carries workspace identity but no status — and
 * `ProjectBlock` is memoized on that stable reference, so the row can't learn about a
 * child's status without its own subscription. Returns a primitive, so status churn in a
 * project only re-renders the row when the aggregate actually moves.
 *
 * Pass `enabled: false` while the project is expanded: the child rows show their own dots
 * and the selector is pure cost.
 */
export function useSidebarProjectStatusBucket(input: {
  workspaces: readonly SidebarWorkspacePlacement[];
  enabled: boolean;
}): SidebarStateBucket | null {
  const { workspaces, enabled } = input;
  const pendingCreateAttempts = useStoreWithEqualityFn(
    useCreateFlowStore,
    (state) => state.pendingByDraftId,
    workspaceEqualityFns.deep,
  );

  const selector = useCallback(
    (state: { sessions: Record<string, ProjectStatusSession | undefined> }) => {
      if (!enabled) return null;
      return deriveProjectStatusBucket({
        workspaces,
        sessions: state.sessions,
        pendingCreateAttempts,
      });
    },
    [enabled, pendingCreateAttempts, workspaces],
  );

  return useStoreWithEqualityFn(useSessionStore, selector, Object.is);
}

const EMPTY_ORDER: string[] = [];
const EMPTY_PROJECTS: SidebarProjectEntry[] = [];
const EMPTY_WORKSPACES: SidebarWorkspacePlacement[] = [];
const EMPTY_PROJECT_NAMES = new Map<string, string>();

export interface SidebarWorkspacesListResult {
  workspaceSortSupported: boolean;
  workspacePlacements: SidebarWorkspacePlacement[];
  projects: SidebarProjectEntry[];
  projectNamesByViewKey: Map<string, string>;
  isLoading: boolean;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  refreshAll: () => void;
}

export function useSidebarWorkspacesList(options?: {
  hostFilters?: readonly string[];
  enabled?: boolean;
}): SidebarWorkspacesListResult {
  const runtime = getHostRuntimeStore();
  const allHosts = useHosts();
  const hostRegistryLoaded = useHostRegistryLoaded();
  const allServerIds = useMemo(() => allHosts.map((h) => h.serverId), [allHosts]);

  const reconcileHostFilters = useSidebarViewStore((state) => state.reconcileHostFilters);
  const isActive = options?.enabled !== false;

  const serverIds = useSidebarHostIds(options?.hostFilters);
  const health = useDirectoryHealth(serverIds, "workspaces");
  useEffect(() => {
    if (!isActive) return;
    const releases = serverIds.map((serverId) => runtime.acquireDirectoryDemand(serverId));
    return () => releases.forEach((release) => release());
  }, [isActive, runtime, serverIds]);

  useEffect(() => {
    if (!hostRegistryLoaded) {
      return;
    }
    reconcileHostFilters(allServerIds);
  }, [allServerIds, hostRegistryLoaded, reconcileHostFilters]);

  const persistedProjectOrder = useSidebarOrderStore((state) => state.projectOrder ?? EMPTY_ORDER);

  // Connection loss does not invalidate accepted directory rows. Registry removal and directory
  // tombstones still remove rows through their owners; transport filtering lost the scroll anchor.
  const directoryServerIds = useWorkspaceDirectoryServerIds(serverIds);

  const workspaceSort = useSidebarViewStore((state) => state.workspaceSort);
  const groupMode = useSidebarViewStore((state) => state.groupMode);
  const sortSupport = useHostFeatureMap(directoryServerIds, "workspaceSortTimes");
  const workspaceSortSupported = [...sortSupport.values()].every(Boolean);
  const sort =
    groupMode === "project" && (workspaceSort === "manual" || workspaceSortSupported)
      ? workspaceSort
      : undefined;
  const { projects: hostProjects } = useWorkspaceStructure(directoryServerIds, sort);

  const selectPlacements = useMemo(createSidebarWorkspacePlacementSelector, []);
  const botProjectKeys = useSidebarBotProjectKeys();
  const showBotProjects = useShowBotProjects().visible;
  const quickChatRoots = useQuickChatRoots(directoryServerIds);
  const quickChatName = useTranslation().t("home.start.quickChat");
  const sidebarModel = useMemo(() => {
    const quickKeys = quickChatProjectKeys(hostProjects, quickChatRoots);
    // Clisbot Navigation V2: Bot and Quick chat sessions are Workspace sessions; the Bots chip
    // hides Bot sessions by their label, and Quick chats fold into one project.
    if (NAVIGATION_V2_ENABLED)
      return selectPlacements(mergeQuickChatProjects(hostProjects, quickKeys, quickChatName));
    return selectPlacements(
      projectBotWorkspaces(
        projectBotWorkspaces(hostProjects, botProjectKeys, showBotProjects),
        quickKeys,
        false,
      ),
    );
  }, [
    hostProjects,
    botProjectKeys,
    showBotProjects,
    quickChatRoots,
    quickChatName,
    selectPlacements,
  ]);

  const projects = sidebarModel.projects.length > 0 ? sidebarModel.projects : EMPTY_PROJECTS;
  const workspacePlacements =
    sidebarModel.workspaces.length > 0 ? sidebarModel.workspaces : EMPTY_WORKSPACES;
  const projectNamesByViewKey =
    sidebarModel.projectNamesByViewKey.size > 0
      ? sidebarModel.projectNamesByViewKey
      : EMPTY_PROJECT_NAMES;

  useEffect(() => {
    const orderStore = useSidebarOrderStore.getState();
    const updates = computeSidebarOrderUpdates({
      projects,
      persistedProjectOrder,
      getWorkspaceOrder: sort === "manual" ? orderStore.getWorkspaceOrder : undefined,
    });

    if (updates.projectOrder) {
      orderStore.setProjectOrder(updates.projectOrder);
    }
    for (const update of updates.workspaceOrders) {
      orderStore.setWorkspaceOrder(update.projectViewKey, update.order);
    }
  }, [persistedProjectOrder, projects, sort]);

  const refreshAll = useCallback(() => {
    if (!isActive) return;
    for (const serverId of serverIds) {
      void runtime.refreshDirectories(serverId).catch((error) => {
        console.error("[WorkspaceFetch][sidebar-refresh] failed", {
          serverId,
          error,
        });
      });
    }
  }, [isActive, runtime, serverIds]);

  // Read pending state independently of demand activation: the first visible retained frame
  // can precede activation, and must not claim a ready empty directory.
  const isLoading = health.status === "loading" || health.status === "refreshing";
  const loadingState = {
    isLoading,
    isInitialLoad: isLoading && !health.hasAcceptedResult,
    isRevalidating: isLoading && (health.hasAcceptedResult || projects.length > 0),
  };

  return {
    workspaceSortSupported,
    workspacePlacements,
    projects,
    projectNamesByViewKey,
    ...loadingState,
    refreshAll,
  };
}
