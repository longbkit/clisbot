import { participationKeyOf } from "@/clisbot/navigation/ownership-key";
import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import { useTranslation } from "react-i18next";
import {
  matchesSessionMetadata,
  sessionMetadataOptions,
  sessionMetadataRecoveryNotice,
} from "@/clisbot/session-storage/directory";
import { sessionStorageReadable } from "@/clisbot/session-storage/capability";
import { useSessionStore } from "@/stores/session-store";
import { useShallow } from "zustand/react/shallow";
import { useGroupedSidebarView, useSidebarGroupMode } from "@/clisbot/workspace-sessions/model";
import type { StatusDisplayGroup } from "@/clisbot/workspace-sessions/status-sessions";
import React, { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import {
  useSidebarWorkspacesList,
  type SidebarProjectEntry,
  type SidebarWorkspacesListResult,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspaceEntries } from "@/hooks/use-sidebar-workspace-entries";
import { usePinnedSidebarKeys, type PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import {
  hasActiveSidebarLabelFilter,
  useSidebarViewStore,
  type SidebarGroupMode,
} from "@/stores/sidebar-view-store";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import type { SidebarShortcutModel } from "@/utils/sidebar-shortcuts";
import { buildSidebarProjection } from "./sidebar-projection";
import { useWorkListFilter, type WorkFilter } from "@/clisbot/navigation/work-filter";
import {
  WorkspaceSessionFilterProvider,
  useWorkspaceSessionFilter,
  type WorkspaceSessionFilter,
} from "@/clisbot/workspace-sessions/session-filter";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useHeldWhileInactive } from "@/hooks/use-held-while-inactive";
import type { SidebarProjectIconTarget } from "@/utils/sidebar-project-row-model";
import { filterWorkspacesByLabels } from "./sidebar-labels";
import {
  filterWorkspacesByProjects,
  resolveActiveProjectFilters,
  shouldAwaitSidebarEntryProjection,
} from "./sidebar-project-filter";
import {
  hasAuthoritativeWorkspaceLabelCatalog,
  useWorkspaceLabelProjection,
} from "@/workspace-labels";

interface SidebarModel extends SidebarWorkspacesListResult {
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  /** Accepted entries before display filters; pins retain their Host/workspace action identity. */
  allWorkspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  /**
   * Every project the sidebar could show, before any filter narrows it.
   *
   * `projects` is the FILTERED list. A surface that offers a filter picker must read this one, or
   * narrowing the filter deletes the rows that would undo it.
   */
  allProjects: SidebarProjectEntry[];
  metadataRecoveryNotice: string | null;
  /** The user and channel filters' options, for the display menu and the active-filter chips. */
  sessionMetadata: SessionMetadata;
  /** The project filter as it is actually being applied — see `resolveActiveProjectFilters`. */
  resolvedProjectFilters: readonly string[];
  hasProjectsBeforeFilter: boolean;
  groupMode: SidebarGroupMode;
  workspaceGroups: StatusDisplayGroup[];
  projectIconTargets: SidebarProjectIconTarget[];
  pinnedGroups: PinnedSidebarGroups;
  collapsedProjectKeys: ReadonlySet<string>;
  toggleProjectCollapsed: (projectViewKey: string) => void;
  shortcutModel: SidebarShortcutModel;
  /**
   * Clisbot Navigation V2: the Workspace list's scope/chip/Bots rule and the root sessions it
   * reads. Pinned rows, counts and session lines all ask it, so a pin never escapes the scope.
   */
  workList: ReturnType<typeof useWorkListFilter>;
}

const SidebarModelContext = createContext<SidebarModel | null>(null);

export function SidebarModelProvider({
  active,
  holdWhileInactive = false,
  children,
}: {
  active?: boolean;
  /**
   * For a provider read only by one retained pane (the phone's Work tab): while inactive it
   * derives nothing and hands out the model it had when hidden; the first active render catches
   * up. Without it an inactive provider stays live for the keyboard shortcuts.
   */
  holdWhileInactive?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const live = active !== false || !holdWhileInactive;
  const list = useSidebarWorkspacesList({ enabled: active, held: !live });
  const showBackground = useSidebarViewStore((state) => state.showBackground);
  const groupMode = useSidebarGroupMode();
  const userFilters = useSidebarViewStore((state) => state.userFilters);
  const channelFilters = useSidebarViewStore((state) => state.channelFilters);
  // Clisbot Navigation V2: Work's scope and quick-filter chips narrow workspaces like metadata does.
  const workFilter = useWorkListFilter(live);
  const hasMetadataFilter = userFilters.length > 0 || channelFilters.length > 0;
  const hasEntryFilter = hasMetadataFilter || workFilter !== null;
  const labelFilter = useSidebarViewStore((state) => state.labelFilter);
  const projectFilters = useSidebarViewStore((state) => state.projectFilters);
  const reconcileLabelFilter = useSidebarViewStore((state) => state.reconcileLabelFilter);
  const labelHosts = useHeldWhileInactive(useWorkspaceLabelProjection().hosts, live);
  const collapsedProjectKeys = useSidebarCollapsedSectionsStore(
    (state) => state.collapsedProjectKeys,
  );
  const collapsedWorkspaceGroupKeys = useSidebarCollapsedSectionsStore(
    (state) => state.collapsedWorkspaceGroupKeys,
  );
  const pinnedCollapsed = useSidebarCollapsedSectionsStore((state) => state.collapsedPinned);
  const pinnedWorkspaceOrder = useSidebarOrderStore((state) => state.pinnedWorkspaceOrder);
  const toggleProjectCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.toggleProjectCollapsed,
  );
  const availableLabelNames = useMemo(
    () => labelHosts.flatMap((host) => host.labels.map((label) => label.name)),
    [labelHosts],
  );
  const hasAuthoritativeLabelCatalog = hasAuthoritativeWorkspaceLabelCatalog(labelHosts);
  useEffect(() => {
    if (!hasAuthoritativeLabelCatalog) return;
    reconcileLabelFilter(availableLabelNames);
  }, [availableLabelNames, hasAuthoritativeLabelCatalog, reconcileLabelFilter]);
  const hasActiveLabelFilter = hasActiveSidebarLabelFilter(labelFilter);
  const resolvedProjectFilters = useMemo(
    () =>
      resolveActiveProjectFilters(
        projectFilters,
        new Set(list.projects.map((project) => project.viewKey)),
      ),
    [projectFilters, list.projects],
  );
  const hasActiveProjectFilter = resolvedProjectFilters.length > 0;
  // The project filter is deliberately absent from this gate. It reads `projectViewKey`, which
  // lives on the project and the placement, so it can narrow the project list without hydrating
  // anything; the label filter reads `labels`, which only exists on an entry. Hydration opens a
  // live session-store subscription over every workspace on every visible host, so widening this
  // for a filter that does not need it costs a retained-but-inactive sidebar real work.
  const needsWorkspaceEntries = groupMode !== "project" || hasActiveLabelFilter || hasEntryFilter;
  const entriesEnabled = active !== false || needsWorkspaceEntries;
  const workspaceEntriesByKey = useSidebarWorkspaceEntries(
    list.workspacePlacements,
    entriesEnabled,
    live,
  );
  const filteredWorkspaceEntriesByKey = useMemo(() => {
    const byProject = filterWorkspacesByProjects({
      workspaces: [...workspaceEntriesByKey.values()],
      projectFilters: resolvedProjectFilters,
    });
    const filtered = filterWorkspacesByLabels({
      workspaces: byProject.filter((workspace) => showBackground || !workspace.background),
      ...labelFilter,
    })
      .filter((workspace) => matchesSessionMetadata(workspace, userFilters, channelFilters))
      .filter((workspace) => workFilter?.filter.workspace(workspace) ?? true);
    return new Map(filtered.map((workspace) => [workspace.workspaceKey, workspace]));
  }, [
    workFilter,
    showBackground,
    labelFilter,
    userFilters,
    channelFilters,
    resolvedProjectFilters,
    workspaceEntriesByKey,
  ]);
  const visibleWorkspaceKeys = useMemo(
    () => new Set(filteredWorkspaceEntriesByKey.keys()),
    [filteredWorkspaceEntriesByKey],
  );
  // The two filters prune differently on purpose. The project filter is a membership test on the
  // project itself, so a project you filtered TO survives even with no workspaces — it still owns
  // a header row you can create your first workspace under. Label and user/channel metadata
  // filters only ask about workspaces, so a project they empty has nothing left to show.
  const filteredProjects = useMemo(() => {
    let projects = list.projects;
    if (hasActiveProjectFilter) {
      const included = new Set(resolvedProjectFilters);
      projects = projects.filter((project) => included.has(project.viewKey));
    }
    if (hasActiveLabelFilter || hasEntryFilter || !showBackground) {
      projects = projects.flatMap((project) => {
        const workspaces = project.workspaces.filter((workspace) =>
          visibleWorkspaceKeys.has(workspace.workspaceKey),
        );
        return workspaces.length > 0 ||
          (!hasActiveLabelFilter && !hasEntryFilter && project.workspaces.length === 0)
          ? [workspaces.length === project.workspaces.length ? project : { ...project, workspaces }]
          : [];
      });
    }
    return projects;
  }, [
    showBackground,
    hasActiveLabelFilter,
    hasEntryFilter,
    hasActiveProjectFilter,
    resolvedProjectFilters,
    list.projects,
    visibleWorkspaceKeys,
  ]);
  // Activation hydrates the existing collection subscription. Until then, an absent retained
  // entry cannot truthfully establish that background/metadata filtering matched no workspaces.
  // Keep visible partial content, accepted empty results, and authoritative active removals.
  const awaitingEntryProjection = shouldAwaitSidebarEntryProjection({
    entriesEnabled,
    directoryInitialLoading: list.isInitialLoad,
    placements: list.workspacePlacements,
    entries: workspaceEntriesByKey,
    hasVisibleProjects: filteredProjects.length > 0,
  });
  const pinnedKeys = usePinnedSidebarKeys(filteredProjects);
  const projectionInput = useMemo(
    () => ({
      projects: filteredProjects,
      pinnedKeys,
      pinnedWorkspaceOrder,
      workspaceEntriesByKey: filteredWorkspaceEntriesByKey,
      projectNamesByViewKey: list.projectNamesByViewKey,
      groupMode,
      pinnedCollapsed,
      collapsedProjectKeys,
      collapsedWorkspaceGroupKeys,
      t,
    }),
    [
      collapsedProjectKeys,
      collapsedWorkspaceGroupKeys,
      groupMode,
      list.projectNamesByViewKey,
      filteredProjects,
      pinnedCollapsed,
      pinnedKeys,
      pinnedWorkspaceOrder,
      filteredWorkspaceEntriesByKey,
      t,
    ],
  );
  const projection = useMemo(() => buildSidebarProjection(projectionInput), [projectionInput]);
  // Clisbot: with Agent sessions on, the session modes list sessions and the shortcuts walk them.
  const sessionFilter = useMemo(
    () => (workFilter ? toSessionLineFilter(workFilter.filter, workFilter.pinnedSessions) : null),
    [workFilter],
  );
  const statusView = useGroupedSidebarView({
    projection,
    groupMode,
    pinnedCollapsed,
    collapsedWorkspaceGroupKeys,
    sessionFilter,
    live,
  });
  const metadataRecoveryNotice = useMemo(
    () => sessionMetadataRecoveryNotice(workspaceEntriesByKey.values(), hasMetadataFilter),
    [workspaceEntriesByKey, hasMetadataFilter],
  );
  const sessionMetadata = useSessionMetadata(live);
  const value = useMemo(
    () => ({
      ...list,
      isLoading: list.isLoading || awaitingEntryProjection,
      isInitialLoad: awaitingEntryProjection,
      metadataRecoveryNotice,
      sessionMetadata,
      projects: filteredProjects,
      allProjects: list.projects,
      resolvedProjectFilters,
      hasProjectsBeforeFilter: list.projects.length > 0,
      workspaceEntriesByKey: filteredWorkspaceEntriesByKey,
      allWorkspaceEntriesByKey: workspaceEntriesByKey,
      groupMode,
      workspaceGroups: statusView.workspaceGroups,
      projectIconTargets: projection.projectIconTargets,
      pinnedGroups: projection.pinnedGroups,
      collapsedProjectKeys,
      toggleProjectCollapsed,
      shortcutModel: statusView.shortcutModel,
      workList: workFilter,
    }),
    [
      workFilter,
      awaitingEntryProjection,
      metadataRecoveryNotice,
      sessionMetadata,
      resolvedProjectFilters,
      collapsedProjectKeys,
      groupMode,
      list,
      filteredProjects,
      projection,
      statusView.workspaceGroups,
      statusView.shortcutModel,
      toggleProjectCollapsed,
      filteredWorkspaceEntriesByKey,
      workspaceEntriesByKey,
    ],
  );

  return (
    <SidebarModelContext.Provider value={value}>
      <WorkspaceSessionFilterProvider value={sessionFilter}>
        {children}
      </WorkspaceSessionFilterProvider>
    </SidebarModelContext.Provider>
  );
}

/**
 * The model as a retained list pane sees it: held while that pane's retained panel is inactive.
 * The provider stays live for the keyboard shortcuts and the visible chrome; a hidden Work pane
 * keeps its last model and catches up in its first render back.
 */
export function RetainedSidebarModel({ children }: { children: ReactNode }) {
  const active = useRetainedPanelActive();
  const model = useHeldWhileInactive(useContext(SidebarModelContext), active);
  const sessionFilter = useHeldWhileInactive(useWorkspaceSessionFilter(), active);
  return (
    <SidebarModelContext.Provider value={model}>
      <WorkspaceSessionFilterProvider value={sessionFilter}>
        {children}
      </WorkspaceSessionFilterProvider>
    </SidebarModelContext.Provider>
  );
}

interface SessionMetadata {
  options: ReturnType<typeof sessionMetadataOptions>;
  /** Some Host stores session metadata, so the user and channel filters apply. */
  available: boolean;
}

/**
 * Every Host's session users and channels, read once per change for the display menu and the
 * active-filter chips; each used to rescan all workspaces itself, hidden or not.
 */
function useSessionMetadata(live: boolean): SessionMetadata {
  const metadataHosts = useHeldWhileInactive(
    useSessionStore(
      useShallow((state) =>
        Object.values(state.sessions)
          .filter((session) => sessionStorageReadable(session.serverInfo))
          .map((session) => session.workspaces),
      ),
    ),
    live,
  );
  return useMemo(
    () => ({
      options: sessionMetadataOptions(
        metadataHosts.flatMap((workspaces) => [...workspaces.values()]),
      ),
      available: metadataHosts.length > 0,
    }),
    [metadataHosts],
  );
}

/** For surfaces that may render outside the list (Home pin tags); null when no list is mounted. */
export function useOptionalSidebarModel(): SidebarModel | null {
  return useContext(SidebarModelContext);
}

export function useSidebarModel(): SidebarModel {
  const model = useContext(SidebarModelContext);
  if (!model) throw new Error("SidebarModelProvider is required");
  return model;
}

function toSessionLineFilter(
  filter: WorkFilter,
  pinned: ReadonlySet<string>,
): WorkspaceSessionFilter {
  return (session) =>
    !pinned.has(`${session.agent.serverId}:${session.agent.id}`) &&
    filter.session(
      {
        id: session.agent.id,
        labels: session.agent.labels,
        createdBy: session.agent.createdBy,
        participationKey: participationKeyOf(session.agent),
        statusBucket: session.statusBucket,
        unverified: session.unverified,
      },
      { serverId: session.agent.serverId },
    );
}
