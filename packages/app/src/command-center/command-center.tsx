import { useOverlayRegistration, type KeyboardInputEvent } from "@/keyboard";
import { Modal } from "@/components/ui/modal";
import equal from "fast-deep-equal";
import { recordRenderProfileReasons } from "@/utils/render-profiler";
import {
  FlatList,
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
} from "react-native";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { BottomSheetFlatList, type BottomSheetFlatListMethods } from "@gorhom/bottom-sheet";
import { useAgentDescriptor, resolveAgentLabel } from "@/agent-presentation";
import { useArchivedWorkspaceSearch, type ArchivedWorkspace } from "@/archived-workspaces";
import { ArchivedBadge } from "@/components/archived-badge";
import { StatusIcon } from "@/components/status-icon";
import { useWorkspaceStatus } from "@/workspace-status";
import type { SurfaceBackdrop } from "@/styles/surface-backdrop";
import type { Theme } from "@/styles/theme";
import { HighlightedText, type HighlightedTextProps } from "@/components/ui/highlighted-text";
import { findHighlightRanges } from "@/components/ui/highlighted-text-segments";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { useProviderIcon } from "@/components/provider-icons";
import { ProjectIconView } from "@/components/project-icon-view";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Shortcut } from "@/components/ui/shortcut";
import {
  IsolatedBottomSheetModal,
  useIsolatedBottomSheetVisibility,
} from "@/components/ui/isolated-bottom-sheet-modal";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import { useAggregatedAgents, type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useProjects } from "@/hooks/use-projects";
import { useTimeAgo } from "@/hooks/use-time-ago";
import { createProjectIconTarget } from "@/projects/icon-target";
import { useProjectIcons } from "@/projects/icons";
import { OverlayLayerProvider, useGlobalOverlayLayer } from "@/lib/overlay-root";
import { useHostRuntimeConnectionStatuses, useHosts } from "@/runtime/host-runtime";
import { useHydratedWorkspaceServerIds } from "@/stores/session-store-hooks";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import {
  navigateToWorkspace,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
import {
  clearCommandCenterFocusRestoreElement,
  takeCommandCenterFocusRestoreElement,
} from "@/utils/command-center-focus-restore";
import { focusWithRetries } from "@/utils/web-focus";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { shortenPath } from "@/utils/shorten-path";
import { projectIconPlaceholderLabelFromDisplayName } from "@/utils/project-display-name";
import { getProjectSummaryForHostProject, type ProjectSummary } from "@/utils/projects";
import {
  COMMAND_CENTER_LINE_HEIGHT,
  COMMAND_CENTER_LIST_METRICS,
  COMMAND_CENTER_SECTION_GAP,
  type CommandCenterListMetrics,
} from "./list-metrics";
import { useCommandCenterContributions } from "./provider";
import { createWorkspaceRanker } from "./workspace-search";
import {
  filterAndRankBuiltInResults,
  joinSubtitleParts,
  PINNED_SECTION_BAND,
  projectCommandCenterRows,
  type CommandCenterAgentResult,
  type CommandCenterExtensionResult,
  type CommandCenterFileResult,
  type CommandCenterListRow,
  type CommandCenterResult,
  type CommandCenterResultSection,
  type CommandCenterSearchFields,
  type CommandCenterWorkspaceAgent,
  type CommandCenterWorkspaceResult,
} from "./results";
import { buildCommandCenterSections } from "./sections";
import {
  availableCommandCenterTabs,
  resolveCommandCenterTab,
  rotateCommandCenterTab,
  type CommandCenterTab,
} from "./tabs";
import { createCommandCenterInteraction, type CommandCenterInteraction } from "./interaction";
import { useWorkspaceFileSearch } from "./workspace-file-search";
import { ScopeChips } from "@/clisbot/search-scope/scope-chips";
import { useSearchScope, type SearchScope } from "@/clisbot/search-scope/use-search-scope";
import { isSearchScopeActive, SEARCH_SCOPE_ENABLED } from "@/clisbot/search-scope/active";

const ThemedBottomSheetTextInput = withUnistyles(TextInput, (theme) => ({
  placeholderTextColor: theme.colors.placeholder,
}));
const ThemedTextInput = withUnistyles(TextInput, (theme) => ({
  placeholderTextColor: theme.colors.placeholder,
}));
const ThemedCheck = withUnistyles(Check, (theme) => ({ color: theme.colors.foreground }));
const ThemedChevronRight = withUnistyles(ChevronRight, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const COMMAND_CENTER_SNAP_POINTS = ["60%", "90%"];
const KEYBOARD_SHOULD_PERSIST_TAPS = "always" as const;

/** `cwd` is not rendered, so a path match must never outrank a match on text the user can see. */
function agentSearchFields(result: CommandCenterAgentResult): CommandCenterSearchFields {
  return { visible: [result.title, result.subtitle], hidden: [result.agent.cwd] };
}

function rankAgentRows(rows: readonly CommandCenterAgentResult[], query: string) {
  return filterAndRankBuiltInResults(rows, query, agentSearchFields);
}

function createWorkspaceResultAction(serverId: string, workspaceId: string) {
  return () => {
    clearCommandCenterFocusRestoreElement();
    navigateToWorkspace({ serverId, workspaceId });
  };
}

function createAgentResultAction(serverId: string) {
  return (agentId: string) => {
    clearCommandCenterFocusRestoreElement();
    navigateToAgent({ serverId, agentId });
  };
}

const NO_WORKSPACE_AGENTS: readonly CommandCenterWorkspaceAgent[] = [];

/** Each workspace's titled agents, most recent first, keyed `serverId:workspaceId`. */
function groupWorkspaceAgents(
  agents: readonly AggregatedAgent[],
): Map<string, CommandCenterWorkspaceAgent[]> {
  const byWorkspace = new Map<string, CommandCenterWorkspaceAgent[]>();
  const newestFirst = [...agents].sort(
    (left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime(),
  );
  for (const agent of newestFirst) {
    const title = resolveAgentLabel(agent.title);
    if (!agent.workspaceId || !title) continue;
    const key = `${agent.serverId}:${agent.workspaceId}`;
    const list = byWorkspace.get(key) ?? [];
    list.push({ id: agent.id, title, provider: agent.provider });
    byWorkspace.set(key, list);
  }
  return byWorkspace;
}

function createArchivedAgentAction(serverId: string, workspaceId: string) {
  // Opening on an agent with the tab pinned is what offers Unarchive, as History does.
  return (agentId: string) => {
    clearCommandCenterFocusRestoreElement();
    navigateToAgent({ serverId, agentId, workspaceId, pin: true });
  };
}

function titledAgents(
  agents: readonly { id: string; title: string | null; provider: string }[],
): CommandCenterWorkspaceAgent[] {
  return agents.flatMap((agent) => {
    const title = resolveAgentLabel(agent.title);
    return title ? [{ id: agent.id, title, provider: agent.provider }] : [];
  });
}

interface WorkspaceRows {
  active: CommandCenterWorkspaceResult[];
  archived: CommandCenterWorkspaceResult[];
  /** Clisbot: every session as a row of its own, for Host / Project scope and Bot chats. */
  agents: CommandCenterAgentResult[];
  /** Clisbot: what Host / Project scope places the rows in. */
  directory: { projects: readonly ProjectSummary[]; agents: readonly AggregatedAgent[] };
  /** The workspace list has not loaded yet, so rows are still arriving. */
  loading: boolean;
}

/**
 * Build every workspace row. Deliberately not keyed on `query`: none of this work depends on
 * what was typed. Ordering belongs to the workspace ranker, which ranks on every keystroke.
 * Archived rows come from the host's history search, so they change with its results.
 */
function useWorkspaceRows(
  open: boolean,
  archivedWorkspaces: readonly ArchivedWorkspace[],
): WorkspaceRows {
  const { t } = useTranslation();
  const previousRows = useRef(new Map<string, CommandCenterWorkspaceResult>());
  const previousAgentRows = useRef(new Map<string, CommandCenterAgentResult>());
  const { agents, isInitialLoad: agentsLoading } = useAggregatedAgents({ demand: open });
  const { projects, isLoading: projectsLoading } = useProjects({ enabled: open });
  const hosts = useHosts();
  const workspacesArriving = useWorkspacesArriving(open, hosts);
  const showHost = hosts.length > 1;
  const iconTargets = useMemo(
    () =>
      open
        ? projects.flatMap((project) =>
            project.hosts.flatMap((host) => {
              const target = createProjectIconTarget({
                projectViewKey: project.viewKey,
                placement: { ...host, iconWorkingDir: host.repoRoot },
              });
              return target ? [target] : [];
            }),
          )
        : [],
    [open, projects],
  );
  const iconDataByProjectViewKey = useProjectIcons({ projects: iconTargets });

  const active = useMemo(() => {
    if (!open) {
      previousRows.current.clear();
      return [];
    }
    // Workspace IDs identify immutable navigation targets. Reuse their callbacks and unchanged
    // row data so a directory update does not invalidate every mounted ResultRow.
    const nextRows = new Map<string, CommandCenterWorkspaceResult>();
    const preserve = (row: CommandCenterWorkspaceResult): CommandCenterWorkspaceResult => {
      const previous = previousRows.current.get(row.id);
      if (previous) {
        row.run = previous.run;
        row.openAgent = previous.openAgent;
      }
      const stable = previous && equal(previous, row) ? previous : row;
      nextRows.set(row.id, stable);
      return stable;
    };
    const agentsByWorkspace = groupWorkspaceAgents(agents);
    const rows: CommandCenterWorkspaceResult[] = [];
    for (const project of projects) {
      const workspaceProject = {
        viewKey: project.viewKey,
        name: project.projectName,
        iconDataUri: iconDataByProjectViewKey.get(project.viewKey) ?? null,
      };
      for (const host of project.hosts) {
        for (const workspace of host.workspaces) {
          if (workspace.archivingAt) continue;
          const key = `${host.serverId}:${workspace.id}`;
          rows.push(
            preserve({
              kind: "workspace",
              id: `workspace:${key}`,
              title: workspace.title ?? workspace.name,
              subtitle: joinSubtitleParts([
                showHost ? host.serverName : null,
                project.projectName,
                workspace.currentBranch,
              ]),
              serverId: host.serverId,
              workspaceId: workspace.id,
              project: workspaceProject,
              changeRequestNumber: workspace.changeRequestNumber,
              activityAt: workspace.statusEnteredAt,
              agents: agentsByWorkspace.get(key) ?? NO_WORKSPACE_AGENTS,
              matchedAgent: null,
              archived: false,
              background: workspace.background,
              run: createWorkspaceResultAction(host.serverId, workspace.id),
              openAgent: createAgentResultAction(host.serverId),
            }),
          );
        }
      }
    }
    previousRows.current = nextRows;
    return rows;
  }, [agents, iconDataByProjectViewKey, open, projects, showHost]);

  const archived = useMemo(() => {
    const activeIds = new Set(active.map((row) => row.id));
    const hostLabels = new Map(hosts.map((host) => [host.serverId, host.label]));
    return archivedWorkspaces.flatMap<CommandCenterWorkspaceResult>((workspace) => {
      const id = `workspace:${workspace.key}`;
      // The host's history can trail its workspace list; the active row wins.
      if (activeIds.has(id)) return [];
      const project = workspace.projectKey
        ? getProjectSummaryForHostProject(projects, workspace.serverId, workspace.projectKey)
        : undefined;
      const projectName = project?.projectName ?? workspace.projectName ?? workspace.name;
      const openAgent = createArchivedAgentAction(workspace.serverId, workspace.workspaceId);
      const latestAgentId = workspace.agents[0].id;
      return [
        {
          kind: "workspace",
          id,
          title: workspace.name,
          subtitle: joinSubtitleParts([
            showHost ? (hostLabels.get(workspace.serverId) ?? workspace.serverId) : null,
            projectName,
            workspace.branch,
          ]),
          serverId: workspace.serverId,
          workspaceId: workspace.workspaceId,
          project: {
            viewKey: project?.viewKey ?? `archived:${workspace.key}`,
            name: projectName,
            iconDataUri: project ? (iconDataByProjectViewKey.get(project.viewKey) ?? null) : null,
          },
          changeRequestNumber: null,
          activityAt: workspace.archivedAt,
          agents: titledAgents(workspace.agents),
          matchedAgent: null,
          archived: true,
          background: false,
          run: () => openAgent(latestAgentId),
          openAgent,
        },
      ];
    });
  }, [active, archivedWorkspaces, hosts, iconDataByProjectViewKey, projects, showHost]);

  const agentRows = useMemo(() => {
    if (!open) {
      previousAgentRows.current.clear();
      return [];
    }
    const workspaceTitleByKey = new Map(
      active.map((workspace) => [workspace.id.slice("workspace:".length), workspace.title]),
    );
    const nextRows = new Map<string, CommandCenterAgentResult>();
    const rows = agents.map((agent) => {
      const workspaceTitle = agent.workspaceId
        ? workspaceTitleByKey.get(`${agent.serverId}:${agent.workspaceId}`)
        : undefined;
      const row: CommandCenterAgentResult = {
        kind: "agent",
        id: `agent:${agent.serverId}:${agent.id}`,
        agent,
        title: resolveAgentLabel(agent.title) ?? t("workspace.tabs.loading"),
        subtitle: joinSubtitleParts([
          showHost ? agent.serverLabel : null,
          workspaceTitle ?? shortenPath(agent.cwd),
        ]),
        activityAt: agent.lastActivityAt,
        run: () => createAgentResultAction(agent.serverId)(agent.id),
      };
      const previous = previousAgentRows.current.get(row.id);
      if (previous) row.run = previous.run;
      const stable = previous && equal(previous, row) ? previous : row;
      nextRows.set(row.id, stable);
      return stable;
    });
    previousAgentRows.current = nextRows;
    return rows;
  }, [active, agents, open, showHost, t]);
  const directory = useMemo(() => ({ projects, agents }), [agents, projects]);

  return {
    active,
    archived,
    agents: agentRows,
    directory,
    // Opening a workspace route loads that workspace before the rest of the directory, so rows
    // are no sign that the list is complete.
    loading: agentsLoading || projectsLoading || workspacesArriving,
  };
}

/**
 * An online host's workspaces have not arrived yet. Its agent directory reports ready before
 * the workspace snapshot lands, so until then the workspace rows are incomplete.
 */
function useWorkspacesArriving(open: boolean, hosts: readonly { serverId: string }[]): boolean {
  const serverIds = useMemo(() => (open ? hosts.map((host) => host.serverId) : []), [hosts, open]);
  const connectionStatuses = useHostRuntimeConnectionStatuses(serverIds);
  const hydratedServerIds = useHydratedWorkspaceServerIds(serverIds);
  return serverIds.some(
    (serverId) =>
      connectionStatuses.get(serverId) === "online" && !hydratedServerIds.includes(serverId),
  );
}

interface CommandCenterState {
  open: boolean;
  /** The rows have been built for this open; until then the list shows nothing, not "No matches". */
  rowsReady: boolean;
  /** The input's `onLayout`: the panel is on screen, so the rows may be built. */
  showPanel(): void;
  /** The tabs on offer, in the order Tab walks them. */
  tabs: readonly CommandCenterTab[];
  tab: CommandCenterTab;
  selectTab(tab: CommandCenterTab): void;
  query: string;
  setQuery(query: string): void;
  activeId: string | null;
  rows: readonly CommandCenterListRow[];
  offsets: readonly number[];
  inputRef: React.RefObject<EditingTextInputHandle | null>;
  fileSearchLoading: boolean;
  fileSearchError: string | null;
  searchScope: SearchScope;
  close(): void;
  select(result: CommandCenterResult): void;
  selectSecondary(result: CommandCenterResult): void;
  key(event: CommandCenterKeyEvent): boolean;
}

interface CommandCenterKeyEvent {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

/**
 * Clisbot search scope keys on a Host / Project row: Tab accepts it as a chip, ⌘/Ctrl+Enter runs
 * "Show in Work". Null when the key is not one of these; "pass" lets the key do its usual job.
 */
function handleExtensionKey(
  event: CommandCenterKeyEvent,
  selected: CommandCenterResult | undefined,
): "select" | "secondary" | "pass" | null {
  if (selected?.kind !== "extension") return null;
  if (event.key === "Tab" && !event.shiftKey) return selected.acceptsTab ? "select" : "pass";
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    return selected.secondary ? "secondary" : "pass";
  }
  return null;
}

/** Runs an extension row's key action; true when the key was consumed. */
function dispatchExtensionKey(
  event: CommandCenterKeyEvent,
  selected: CommandCenterResult | undefined,
  actions: {
    select: (result: CommandCenterResult) => void;
    selectSecondary: (result: CommandCenterResult) => void;
  },
): boolean {
  const extensionKey = handleExtensionKey(event, selected);
  if (extensionKey === "select" && selected) actions.select(selected);
  if (extensionKey === "secondary" && selected) actions.selectSecondary(selected);
  return extensionKey === "select" || extensionKey === "secondary";
}

interface ClisbotScopeSectionsInput {
  tab: CommandCenterTab;
  query: string;
  searchScope: SearchScope;
  /** Search scope is running for this tab (`isSearchScopeActive`). */
  scopeActive: boolean;
  archived: readonly CommandCenterWorkspaceResult[];
  agentsTitle: string;
}

/**
 * Clisbot: Host / Project scope over upstream's tabbed sections. Unscoped, the workspace rows take
 * the scope's notes and ordering, sessions get their own section, and the Host and Project
 * suggestions join the list. Scoped, the list is the scope: commands and files step aside. Off
 * (`EXPO_PUBLIC_CLISBOT_SEARCH_SCOPE=0`, or the Files and Actions tabs) it is upstream's list.
 */
function withSearchScopeSections(
  sections: CommandCenterResultSection[],
  input: ClisbotScopeSectionsInput,
): CommandCenterResultSection[] {
  if (!input.scopeActive) return sections;
  const { searchScope } = input;
  const agentsSection: CommandCenterResultSection = {
    id: "agents",
    band: PINNED_SECTION_BAND,
    rank: 3,
    title: input.agentsTitle,
    results: searchScope.agents,
  };
  const scopedWorkspaces = (section: CommandCenterResultSection): CommandCenterResultSection => ({
    ...section,
    // Archived rows come from the host's search and carry no scope placement: unscoped only.
    results: searchScope.scoped
      ? searchScope.workspaces
      : [...searchScope.workspaces, ...input.archived],
  });
  if (searchScope.scoped) {
    const workspaces = sections.find((section) => section.id === "workspaces");
    return [
      ...searchScope.sections,
      scopedWorkspaces(
        workspaces ?? { id: "workspaces", band: PINNED_SECTION_BAND, rank: 2, results: [] },
      ),
      agentsSection,
    ];
  }
  const merged = sections.map((section) =>
    section.id === "workspaces" ? scopedWorkspaces(section) : section,
  );
  if (input.tab === "workspaces") return [...searchScope.sections, ...merged];
  return [...merged, ...searchScope.sections, agentsSection];
}

function useCommandCenterState(
  listMetrics: CommandCenterListMetrics,
  interaction: CommandCenterInteraction,
  isCompact: boolean,
  bottomSheetInputRef: React.RefObject<EditingTextInputHandle | null>,
): CommandCenterState {
  const keyboardActionDispatcher = useKeyboardActionDispatcher();
  const { t } = useTranslation();
  const open = useKeyboardShortcutsStore((state) => state.commandCenterOpen);
  // The rows are built from every workspace and session on every Host: hundreds of ms with
  // thousands of sessions. They wait until the panel's input has been laid out, so the panel is on
  // screen and its input has asked for the keyboard first.
  const [panelShown, setPanelShown] = useState(false);
  if (!open && panelShown) setPanelShown(false);
  const rowsOpen = open && panelShown;
  const showPanel = useCallback(() => setPanelShown(true), []);
  const requestedTab = useKeyboardShortcutsStore((state) => state.commandCenterTab);
  const setOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const setTab = useKeyboardShortcutsStore((state) => state.setCommandCenterTab);
  const snapshot = useCommandCenterContributions();
  const inputRef = useRef<EditingTextInputHandle>(null);
  const previousOpenRef = useRef(open);
  const { query, activeId } = useSyncExternalStore(interaction.subscribe, interaction.getSnapshot);
  const activeWorkspace = useActiveWorkspaceSelection();
  const hasWorkspace = activeWorkspace !== null;
  const tabs = useMemo(() => availableCommandCenterTabs({ hasWorkspace }), [hasWorkspace]);
  const tab = resolveCommandCenterTab(requestedTab, tabs);
  const showBackground = useSidebarViewStore((state) => state.showBackground);
  const listsWorkspaces = tab === "all" || tab === "workspaces";
  const archivedSearch = useArchivedWorkspaceSearch(query, {
    enabled: rowsOpen && listsWorkspaces,
  });
  const workspaceRows = useWorkspaceRows(rowsOpen, archivedSearch.workspaces);
  const [rankWorkspaces] = useState(createWorkspaceRanker);
  // Without a query, background workspaces are listed only when the sidebar lists them.
  const rankScopedWorkspaces = useCallback(
    (rows: readonly CommandCenterWorkspaceResult[], rankQuery: string) =>
      rankWorkspaces(
        rankQuery.trim() || showBackground ? rows : rows.filter((row) => !row.background),
        rankQuery,
      ),
    [rankWorkspaces, showBackground],
  );
  // Host / Project scope runs in All and Workspaces; Files and Actions keep upstream's list.
  const scopeTabs = tab === "files" || tab === "actions";
  const searchScope = useSearchScope({
    open: rowsOpen,
    filesScope: scopeTabs,
    query,
    isCompact,
    projects: workspaceRows.directory.projects,
    agents: workspaceRows.directory.agents,
    workspaceRows: workspaceRows.active,
    agentRows: workspaceRows.agents,
    rankWorkspaces: rankScopedWorkspaces,
    rankAgents: rankAgentRows,
  });
  const scopeActive = isSearchScopeActive({
    enabled: SEARCH_SCOPE_ENABLED,
    open: rowsOpen,
    filesScope: scopeTabs,
  });
  const scoped = searchScope.scoped;
  const currentWorkspaceId = activeWorkspace
    ? `workspace:${activeWorkspace.serverId}:${activeWorkspace.workspaceId}`
    : null;
  const {
    entries: fileSearchEntries,
    loading: fileSearchLoading,
    error: fileSearchError,
    openFile,
  } = useWorkspaceFileSearch({
    // Scope chips hide file rows (they do not live on a Host or Project), so do not fetch them.
    enabled:
      rowsOpen &&
      tabs.includes("files") &&
      (tab === "files" || (tab === "all" && !scoped && Boolean(query.trim()))),
    query,
  });
  const files = useMemo(
    () =>
      fileSearchEntries.map<CommandCenterFileResult>((entry) => ({
        kind: "file",
        id: `file:${entry.path}`,
        filePath: entry.path,
        title: entry.name,
        subtitle: entry.directory,
        run: () => openFile(entry.path),
      })),
    [fileSearchEntries, openFile],
  );
  const archivedForScope = useMemo(
    () =>
      query.trim()
        ? rankWorkspaces(workspaceRows.archived, query, {
            keepUnmatched: archivedSearch.matchedByHost,
          })
        : [],
    [archivedSearch.matchedByHost, query, rankWorkspaces, workspaceRows.archived],
  );
  const upstreamSections = useMemo(
    () =>
      rowsOpen
        ? buildCommandCenterSections({
            tab,
            query,
            rankWorkspaces,
            workspaces: workspaceRows.active,
            archivedWorkspaces: workspaceRows.archived,
            archivedMatchedByHost: archivedSearch.matchedByHost,
            showBackground,
            currentWorkspaceId,
            contributions: snapshot.contributions,
            files,
            titles: {
              recentWorkspaces: t("shell.commandCenter.recentWorkspaces"),
              workspaces: t("shell.commandCenter.workspaces"),
              files: t("shell.commandCenter.files"),
            },
          })
        : [],
    [
      archivedSearch.matchedByHost,
      currentWorkspaceId,
      files,
      rowsOpen,
      query,
      rankWorkspaces,
      showBackground,
      snapshot.contributions,
      t,
      tab,
      workspaceRows,
    ],
  );
  const sections = useMemo(
    () =>
      withSearchScopeSections(upstreamSections, {
        tab,
        query,
        searchScope,
        scopeActive,
        archived: archivedForScope,
        agentsTitle: t("shell.commandCenter.agents"),
      }),
    [archivedForScope, query, scopeActive, searchScope, t, tab, upstreamSections],
  );
  const projection = useMemo(
    () => projectCommandCenterRows(sections, listMetrics),
    [listMetrics, sections],
  );
  const loading =
    fileSearchLoading || (listsWorkspaces && (archivedSearch.pending || workspaceRows.loading));
  useLayoutEffect(() => {
    interaction.update({ open, tab, query, projection, loading });
  }, [interaction, open, tab, query, projection, loading]);

  const close = useCallback(() => setOpen(false), [setOpen]);
  const clearQuery = useCallback(() => {
    inputRef.current?.reset();
    bottomSheetInputRef.current?.reset();
    interaction.setQuery("");
  }, [bottomSheetInputRef, interaction]);
  const select = useCallback(
    (result: CommandCenterResult) => {
      if (result.kind === "extension" && result.keepOpen) {
        result.run();
        clearQuery();
        return;
      }
      setOpen(false);
      void result.run();
    },
    [clearQuery, setOpen],
  );
  const selectSecondary = useCallback(
    (result: CommandCenterResult) => {
      if (result.kind !== "extension" || !result.secondary) return;
      clearCommandCenterFocusRestoreElement();
      setOpen(false);
      result.secondary();
    },
    [setOpen],
  );
  const selectTab = useCallback(
    (next: CommandCenterTab) => {
      setTab(next);
      // A tab click must not take typing away from the search field.
      inputRef.current?.focus();
    },
    [setTab],
  );
  const key = useCallback(
    (event: CommandCenterKeyEvent): boolean => {
      if (!open) return false;
      const pressed = event.key;
      const results = projection.selectableResults;
      if (pressed === "Escape") {
        close();
        return true;
      }
      // Clisbot: an empty field's Backspace drops the last scope chip before it leaves the tab.
      if (pressed === "Backspace" && !query && searchScope.removeLastChip()) return true;
      const selected = results.find((result) => result.id === activeId);
      if (dispatchExtensionKey(event, selected, { select, selectSecondary })) return true;
      if (pressed === "Tab") {
        setTab(rotateCommandCenterTab(tab, event.shiftKey ? "previous" : "next", tabs));
        return true;
      }
      if (pressed === "Backspace" && !query.trim() && tab !== "all") {
        setTab("all");
        return true;
      }
      if (pressed === "Enter") {
        if (!selected) return false;
        select(selected);
        return true;
      }
      if (pressed !== "ArrowDown" && pressed !== "ArrowUp") return false;
      return interaction.move(pressed === "ArrowDown" ? "next" : "previous");
    },
    [
      close,
      open,
      projection.selectableResults,
      query,
      activeId,
      tab,
      tabs,
      searchScope,
      select,
      selectSecondary,
      setTab,
      interaction,
    ],
  );

  useEffect(() => {
    const wasOpen = previousOpenRef.current;
    previousOpenRef.current = open;
    if (open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    }
    if (!wasOpen) return;
    const element = takeCommandCenterFocusRestoreElement();
    if (!element) return;
    const cancel = focusWithRetries({
      focus: () => element.focus(),
      isFocused: () => typeof document !== "undefined" && document.activeElement === element,
      onTimeout: () =>
        keyboardActionDispatcher.dispatch({ id: "message-input.focus", scope: "message-input" }),
    });
    return cancel;
  }, [keyboardActionDispatcher, open]);

  return {
    open,
    rowsReady: rowsOpen,
    showPanel,
    tabs,
    tab,
    selectTab,
    query,
    setQuery: interaction.setQuery,
    activeId,
    rows: projection.rows,
    offsets: projection.offsets,
    inputRef,
    fileSearchLoading,
    fileSearchError,
    searchScope,
    close,
    select,
    selectSecondary,
    key,
  };
}

interface ResultRowProps {
  result: CommandCenterResult;
  height: number;
  query: string;
  active: boolean;
  onSelect(result: CommandCenterResult): void;
  onSelectSecondary(result: CommandCenterResult): void;
}

const ResultRow = memo(function ResultRow({
  result,
  height,
  query,
  active,
  onSelect,
  onSelectSecondary,
}: ResultRowProps) {
  recordRenderProfileReasons(`CommandCenterResultRow:${result.id}`, ["render"]);
  const press = useCallback(() => onSelect(result), [onSelect, result]);
  const pressSecondary = useCallback(() => onSelectSecondary(result), [onSelectSecondary, result]);
  const extension = result.kind === "extension" ? result : null;
  const choice =
    result.kind === "contribution" && result.contribution.presentation.kind === "choice"
      ? result.contribution.presentation
      : null;
  let accessibilityLabel =
    result.kind === "file"
      ? [result.title, result.subtitle].filter(Boolean).join(" ")
      : choice?.path.join(" › ");
  if (extension) accessibilityLabel = extension.accessibilityLabel;
  const accessibilityState = useMemo(
    () => (isNative && choice ? { selected: choice.selected } : undefined),
    [choice],
  );
  const style = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      { height },
      (Boolean(hovered) || pressed || active) && styles.activeRow,
    ],
    [active, height],
  );
  const pressable = (
    <Pressable
      style={style}
      onPress={press}
      onLongPress={extension?.secondary ? pressSecondary : undefined}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      aria-pressed={isWeb ? choice?.selected : undefined}
      testID={
        result.kind === "file"
          ? `command-center-file-row-${result.filePath}`
          : (choice?.testId ?? extension?.testID)
      }
    >
      {(state) => {
        const highlighted =
          active ||
          state.pressed ||
          Boolean((state as PressableStateCallbackType & { hovered?: boolean }).hovered);
        const backdrop = highlighted ? "surface1" : "surface0";
        return extension ? (
          extension.render({ query, backdrop, highlighted })
        ) : (
          <ResultContent result={result} query={query} backdrop={backdrop} />
        );
      }}
    </Pressable>
  );
  if (!extension?.renderAction) return pressable;
  return (
    <ExtensionActionRow
      active={active}
      height={height}
      action={extension.renderAction}
      runSecondary={pressSecondary}
    >
      {pressable}
    </ExtensionActionRow>
  );
});

/**
 * A row with a trailing button beside its pressable (docs/hover.md): hover is tracked on a plain
 * View around both, so moving onto the button keeps it revealed, and the button is never nested
 * inside the row's own button.
 */
function ExtensionActionRow({
  active,
  height,
  action,
  runSecondary,
  children,
}: {
  active: boolean;
  height: number;
  action: NonNullable<CommandCenterExtensionResult["renderAction"]>;
  runSecondary(): void;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const enter = useCallback(() => setHovered(true), []);
  const leave = useCallback(() => setHovered(false), []);
  const frame = useMemo(() => [styles.actionRow, { height }], [height]);
  return (
    <View style={frame} onPointerEnter={enter} onPointerLeave={leave}>
      {children}
      <View style={styles.rowAction}>{action({ revealed: hovered || active, runSecondary })}</View>
    </View>
  );
}

/**
 * Text with the query's terms marked. Marks use the same matcher options the rows were ranked
 * with, so a mark always points at something that made the row match.
 */
function QueryHighlightedText({
  query,
  text,
  ...props
}: { query: string } & Omit<HighlightedTextProps, "ranges">) {
  const ranges = useMemo(() => findHighlightRanges(query, text), [query, text]);
  return <HighlightedText text={text} ranges={ranges} {...props} />;
}

/**
 * The subtitle line of a workspace or agent row. The timestamp is its own text so a long branch
 * truncates without pushing the time out of view, and so the time is never part of what the
 * query matches against. It keeps itself current while the command center stays open.
 */
function SubtitleWithTimestamp({
  query,
  subtitle,
  activityAt,
  note,
  testID,
}: {
  query: string;
  subtitle: string;
  activityAt: Date | null;
  /** Clisbot search scope: "Outside filter", "Offline · cached 10:42". Never matched. */
  note?: string | null;
  testID: string;
}) {
  const timeAgo = useTimeAgo(activityAt);
  return (
    <View style={styles.subtitleLine}>
      <QueryHighlightedText
        query={query}
        text={subtitle}
        style={[styles.subtitle, styles.subtitleText]}
        numberOfLines={1}
        testID={testID}
      />
      {note ? (
        <Text
          style={[styles.subtitle, styles.subtitleText]}
          numberOfLines={1}
          testID="command-center-result-note"
        >
          {subtitle ? `\u00a0· ${note}` : note}
        </Text>
      ) : null}
      {timeAgo ? (
        <Text style={styles.subtitle} numberOfLines={1} testID="command-center-result-timestamp">
          {/* Non-breaking: web collapses a leading plain space in its own flex item. */}
          {subtitle ? `\u00a0· ${timeAgo}` : timeAgo}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The third line of a workspace that matched only through one of its agents: which agent, so the
 * user can tell why the row is here. It starts on the title's rail.
 */
function MatchedAgentLine({
  agent,
  serverId,
  query,
}: {
  agent: CommandCenterWorkspaceAgent;
  serverId: string;
  query: string;
}) {
  const ProviderIcon = useProviderIcon(agent.provider, serverId);
  const Icon = useMemo(() => withUnistyles(ProviderIcon, providerIconMapping), [ProviderIcon]);
  return (
    <View style={styles.agentLine} testID="command-center-workspace-agent">
      <View style={styles.agentLineIcon}>
        <Icon size={12} />
      </View>
      <QueryHighlightedText
        query={query}
        text={agent.title}
        style={[styles.subtitle, styles.subtitleText]}
        numberOfLines={1}
      />
    </View>
  );
}

const providerIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function AgentResultContent({
  result,
  query,
  backdrop,
}: {
  result: CommandCenterAgentResult;
  query: string;
  backdrop: SurfaceBackdrop;
}) {
  const agent = result.agent;
  const descriptor = useAgentDescriptor(
    { kind: "agent", agentId: agent.id },
    { serverId: agent.serverId },
  );
  const Icon = useMemo(
    () => withUnistyles(descriptor.icon, providerIconMapping),
    [descriptor.icon],
  );
  return (
    <View style={styles.rowContent} testID={`command-center-agent-${agent.serverId}:${agent.id}`}>
      <View style={styles.rowMain}>
        <View style={styles.iconSlot}>
          <StatusIcon statusBucket={descriptor.statusBucket} size={16} backdrop={backdrop}>
            <View accessibilityRole="image" accessibilityLabel={descriptor.subtitle}>
              <Icon size={16} />
            </View>
          </StatusIcon>
        </View>
        <View style={styles.textContent}>
          <QueryHighlightedText
            query={query}
            text={result.title}
            style={styles.title}
            numberOfLines={1}
          />
          <SubtitleWithTimestamp
            query={query}
            subtitle={result.subtitle}
            activityAt={result.activityAt}
            note={result.note}
            testID="command-center-agent-subtitle"
          />
        </View>
      </View>
    </View>
  );
}

function WorkspaceResultIcon({
  result,
  backdrop,
}: {
  result: CommandCenterWorkspaceResult;
  backdrop: SurfaceBackdrop;
}) {
  const statusBucket = useWorkspaceStatus(result.serverId, result.workspaceId);
  return (
    <StatusIcon statusBucket={statusBucket} size={16} backdrop={backdrop}>
      <DecorativeProjectIcon project={result.project} />
    </StatusIcon>
  );
}

/**
 * The same project icon the sidebar's workspace rows lead with: its image, or a lettered square.
 * Hidden from assistive tech so the fallback's initial does not prefix the row's name.
 */
function DecorativeProjectIcon({ project }: { project: CommandCenterWorkspaceResult["project"] }) {
  const initial = projectIconPlaceholderLabelFromDisplayName(project.name).charAt(0).toUpperCase();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
      <ProjectIconView
        iconDataUri={project.iconDataUri}
        initial={initial}
        projectViewKey={project.viewKey}
        size={16}
        textStyle={styles.projectIconFallbackText}
      />
    </View>
  );
}

function ResultContent({
  result,
  query,
  backdrop,
}: {
  result: CommandCenterResult;
  query: string;
  backdrop: SurfaceBackdrop;
}) {
  if (result.kind === "file") {
    return (
      <View style={styles.rowContent}>
        <View style={styles.rowMain}>
          <View style={styles.iconSlot} testID="command-center-file-icon">
            <MaterialFileIcon fileName={result.title} size={16} />
          </View>
          <Text style={styles.fileLine} numberOfLines={1} testID="command-center-file-line">
            <QueryHighlightedText
              query={query}
              text={result.title}
              style={styles.fileName}
              testID="command-center-file-name"
            />
            {result.subtitle ? (
              <Text style={styles.filePath} testID="command-center-file-path">
                {" "}
                <QueryHighlightedText query={query} text={result.subtitle} />
              </Text>
            ) : null}
          </Text>
        </View>
      </View>
    );
  }
  if (result.kind === "agent") {
    return <AgentResultContent result={result} query={query} backdrop={backdrop} />;
  }
  if (result.kind === "extension") return null;
  if (result.kind === "workspace") {
    const key = result.id.slice("workspace:".length);
    return (
      <View style={styles.rowContent} testID={`command-center-workspace-${key}`}>
        <View style={styles.rowMain}>
          <View style={styles.iconSlot}>
            {/* An archived workspace runs nothing, so it has no status to show. */}
            {result.archived ? (
              <DecorativeProjectIcon project={result.project} />
            ) : (
              <WorkspaceResultIcon result={result} backdrop={backdrop} />
            )}
          </View>
          <View style={styles.textContent}>
            <QueryHighlightedText
              query={query}
              text={result.title}
              style={styles.title}
              numberOfLines={1}
            />
            <SubtitleWithTimestamp
              query={query}
              subtitle={result.subtitle}
              activityAt={result.activityAt}
              note={result.note}
              testID="command-center-workspace-subtitle"
            />
            {result.matchedAgent ? (
              <MatchedAgentLine
                agent={result.matchedAgent}
                serverId={result.serverId}
                query={query}
              />
            ) : null}
          </View>
        </View>
        {result.archived ? <ArchivedBadge /> : null}
      </View>
    );
  }
  const presentation = result.contribution.presentation;
  const Icon = presentation.icon;
  if (presentation.kind === "action") {
    return (
      <View style={styles.rowContent}>
        <View style={styles.rowMain}>
          {Icon ? (
            <View style={styles.iconSlot}>
              <Icon size={16} />
            </View>
          ) : null}
          <View style={styles.textContent}>
            <QueryHighlightedText
              query={query}
              text={presentation.title}
              style={styles.title}
              numberOfLines={1}
            />
            {presentation.subtitle ? (
              <QueryHighlightedText
                query={query}
                text={presentation.subtitle}
                style={styles.subtitle}
                numberOfLines={1}
              />
            ) : null}
          </View>
        </View>
        {presentation.shortcutKeys ? (
          <Shortcut chord={presentation.shortcutKeys} style={styles.rowShortcut} />
        ) : null}
      </View>
    );
  }
  return (
    <View style={styles.rowContent}>
      <View style={styles.rowMain}>
        {Icon ? (
          <View style={styles.iconSlot}>
            <Icon size={16} />
          </View>
        ) : null}
        <View style={styles.breadcrumb}>
          {presentation.path.map((part, index) => (
            <View
              key={presentation.path.slice(0, index + 1).join("\u0000")}
              style={styles.breadcrumbPart}
            >
              {index > 0 ? <ThemedChevronRight size={13} strokeWidth={2} /> : null}
              <QueryHighlightedText
                query={query}
                text={part}
                style={
                  index === presentation.path.length - 1 ? styles.title : styles.breadcrumbGroup
                }
                numberOfLines={1}
              />
            </View>
          ))}
        </View>
      </View>
      {presentation.selected ? (
        <View style={styles.iconSlot}>
          <ThemedCheck size={16} strokeWidth={2.2} />
        </View>
      ) : null}
    </View>
  );
}

function SectionRow({ row }: { row: Extract<CommandCenterListRow, { kind: "section" }> }) {
  const style = useMemo(() => [styles.section, { height: row.height }], [row.height]);
  return (
    <View style={style}>
      {row.divider ? <View style={styles.sectionDivider} /> : null}
      {row.title ? <Text style={styles.sectionLabel}>{row.title}</Text> : null}
    </View>
  );
}

// Escape arrives without asking; it is registered for `agent.interrupt` anyway.
// Backspace stays off deliberately — on web it returns a tab to All when the field is empty,
// but a registered command would stop the search field deleting text.

const TAB_PLACEHOLDER_KEYS = {
  all: "shell.commandCenter.placeholder",
  workspaces: "shell.commandCenter.workspacePlaceholder",
  files: "shell.commandCenter.filePlaceholder",
  actions: "shell.commandCenter.actionPlaceholder",
} as const satisfies Record<CommandCenterTab, string>;

/** The search field names what the tab searches; All names only the kinds on offer. */
function placeholderKey(tab: CommandCenterTab, tabs: readonly CommandCenterTab[]) {
  if (tab === "all" && !tabs.includes("files")) {
    return "shell.commandCenter.placeholderWithoutFiles";
  }
  return TAB_PLACEHOLDER_KEYS[tab];
}

export function CommandCenter() {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const listRef = useRef<FlatList<CommandCenterListRow>>(null);
  const bottomSheetListRef = useRef<BottomSheetFlatListMethods>(null);
  const bottomSheetInputRef = useRef<EditingTextInputHandle>(null);
  const [interaction] = useState(() =>
    createCommandCenterInteraction((offset) => {
      const list = listRef.current ?? bottomSheetListRef.current;
      list?.scrollToOffset({ offset, animated: false });
    }),
  );
  const state = useCommandCenterState(
    isCompact ? COMMAND_CENTER_LIST_METRICS.compact : COMMAND_CENTER_LIST_METRICS.desktop,
    interaction,
    isCompact,
    bottomSheetInputRef,
  );
  const showBottomSheet = isCompact && isNative;
  const modalLayer = useGlobalOverlayLayer("modal", state.open);
  const { sheetRef, handleSheetChange, handleSheetDismiss } = useIsolatedBottomSheetVisibility({
    visible: state.open,
    isEnabled: showBottomSheet,
    onClose: state.close,
  });

  const handleListLayout = useCallback(
    (event: LayoutChangeEvent) => {
      interaction.layout(event.nativeEvent.layout.height);
    },
    [interaction],
  );
  const handleListScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      interaction.scrolled(event.nativeEvent.contentOffset.y);
    },
    [interaction],
  );
  useEffect(() => {
    if (!showBottomSheet || !state.open) return;
    const timer = setTimeout(() => bottomSheetInputRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, [showBottomSheet, state.open]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<CommandCenterListRow>) =>
      item.kind === "section" ? (
        <SectionRow row={item} />
      ) : (
        <ResultRow
          result={item.result}
          height={item.height}
          query={state.query}
          active={item.result.id === state.activeId}
          onSelect={state.select}
          onSelectSecondary={state.selectSecondary}
        />
      ),
    [state.activeId, state.query, state.select, state.selectSecondary],
  );
  const getItemLayout = useCallback(
    (_data: ArrayLike<CommandCenterListRow> | null | undefined, index: number) => ({
      index,
      length: state.rows[index].height,
      offset: state.offsets[index],
    }),
    [state.offsets, state.rows],
  );
  const keyExtractor = useCallback((row: CommandCenterListRow) => row.key, []);
  const empty = useMemo(
    () =>
      !state.rowsReady || state.fileSearchError || state.fileSearchLoading ? null : (
        <Text style={styles.emptyText}>{t("shell.commandCenter.noMatches")}</Text>
      ),
    [state.fileSearchError, state.fileSearchLoading, state.rowsReady, t],
  );
  const fileSearchError = useMemo(
    () =>
      state.fileSearchError ? (
        <Text
          accessibilityLiveRegion="polite"
          style={styles.errorText}
          testID="command-center-file-search-error"
        >
          {t("common.errors.error")}: {state.fileSearchError}
        </Text>
      ) : null,
    [state.fileSearchError, t],
  );
  const commonListProps = {
    data: state.rows,
    renderItem,
    keyExtractor,
    getItemLayout,
    ListEmptyComponent: empty,
    style: styles.results,
    testID: "command-center-results",
    keyboardShouldPersistTaps: KEYBOARD_SHOULD_PERSIST_TAPS,
    showsVerticalScrollIndicator: false,
    initialNumToRender: 12,
    maxToRenderPerBatch: 10,
    windowSize: 5,
    onLayout: handleListLayout,
    onScroll: handleListScroll,
    onScrollBeginDrag: interaction.beginManualScroll,
    onTouchStart: interaction.beginManualScroll,
    ...(isWeb
      ? {
          onWheel: interaction.beginManualScroll,
          onMouseDown: interaction.beginManualScroll,
        }
      : {}),
    scrollEventThrottle: 16,
  };
  const submit = useCallback(() => state.key({ key: "Enter" }), [state]);
  const handleOverlayKeyDown = useCallback(
    (event: KeyboardInputEvent) => {
      if (!state.key(event)) return false;
      event.preventDefault();
      return true;
    },
    [state],
  );
  const setOverlayScope = useOverlayRegistration({
    keys: ["Escape", "Enter", "ArrowUp", "ArrowDown", "Tab"],
    active: state.open,
    layer: modalLayer,
    onKeyDown: handleOverlayKeyDown,
  });

  const tabOptions = useMemo<SegmentedControlOption<CommandCenterTab>[]>(
    () =>
      state.tabs.map((tab) => ({
        value: tab,
        label: t(`shell.commandCenter.tabs.${tab}`),
        testID: `command-center-tab-${tab}`,
      })),
    [state.tabs, t],
  );
  const tabs = (
    <SegmentedControl
      options={tabOptions}
      value={state.tab}
      onValueChange={state.selectTab}
      size="sm"
      testID="command-center-tabs"
    />
  );
  const placeholder = t(placeholderKey(state.tab, state.tabs));

  if (showBottomSheet) {
    return (
      <IsolatedBottomSheetModal
        ref={sheetRef}
        contextBridge={null}
        snapPoints={COMMAND_CENTER_SNAP_POINTS}
        index={0}
        enableDynamicSizing={false}
        onChange={handleSheetChange}
        onDismiss={handleSheetDismiss}
        backdropOpacity={0.45}
        enablePanDownToClose
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.sheetHandle}
        keyboardBehavior="extend"
        keyboardBlurBehavior="restore"
        accessible={false}
      >
        <OverlayLayerProvider layer={modalLayer}>
          <View style={styles.header} testID="command-center-header">
            <View style={styles.searchRow}>
              {state.searchScope.chips ? <ScopeChips {...state.searchScope.chips} /> : null}
              <ThemedBottomSheetTextInput
                testID="command-center-input"
                ref={bottomSheetInputRef}
                initialValue={state.query}
                variant="bottom-sheet"
                onLayout={state.showPanel}
                onChangeText={state.setQuery}
                onSubmitEditing={submit}
                placeholder={placeholder}
                style={[styles.input, styles.growingInput]}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
              />
              <FileSearchLoadingIndicator
                loading={state.fileSearchLoading}
                label={t("shell.commandCenter.searchingFiles")}
              />
            </View>
          </View>
          <View style={styles.tabBar}>{tabs}</View>
          {fileSearchError}
          <BottomSheetFlatList ref={bottomSheetListRef} {...commonListProps} />
        </OverlayLayerProvider>
      </IsolatedBottomSheetModal>
    );
  }
  if (!state.open) return null;
  return (
    <OverlayLayerProvider layer={modalLayer}>
      <Modal visible transparent animationType="fade" onRequestClose={state.close}>
        <View style={styles.overlay}>
          <Pressable style={styles.backdrop} onPress={state.close} />
          <View ref={setOverlayScope} testID="command-center-panel" style={styles.panel}>
            <View style={styles.header} testID="command-center-header">
              <View style={styles.searchRow}>
                {state.searchScope.chips ? <ScopeChips {...state.searchScope.chips} /> : null}
                <ThemedTextInput
                  testID="command-center-input"
                  ref={state.inputRef}
                  onLayout={state.showPanel}
                  initialValue={state.query}
                  onChangeText={state.setQuery}
                  placeholder={placeholder}
                  style={[styles.input, styles.growingInput]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                />
                <FileSearchLoadingIndicator
                  loading={state.fileSearchLoading}
                  label={t("shell.commandCenter.searchingFiles")}
                />
              </View>
            </View>
            <View style={styles.tabBar}>{tabs}</View>
            {fileSearchError}
            <FlatList ref={listRef} {...commonListProps} />
          </View>
        </View>
      </Modal>
    </OverlayLayerProvider>
  );
}

function FileSearchLoadingIndicator({ loading, label }: { loading: boolean; label: string }) {
  return (
    <View style={styles.fileSearchStatus} testID="command-center-file-search-status">
      {loading ? (
        <View
          accessibilityLabel={label}
          accessibilityRole="progressbar"
          testID="command-center-file-search-loading"
        >
          <ThemedLoadingSpinner size={14} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    flex: 1,
    justifyContent: "flex-start",
    alignItems: "center",
    paddingTop: theme.spacing[12],
  },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0, 0, 0, 0.5)" },
  panel: {
    width: 640,
    height: 560,
    maxWidth: "92%",
    maxHeight: "80%",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
    backgroundColor: theme.colors.surface0,
    ...theme.shadow.lg,
  },
  header: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  // Below the divider, above the list. The first section label brings its own top gap, so the
  // pills sit with equal space above and below. A fixed bar, so switching tabs never moves the
  // field or the list.
  tabBar: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: COMMAND_CENTER_SECTION_GAP,
  },
  input: {
    fontSize: theme.fontSize.base,
    paddingVertical: theme.spacing[1],
    color: theme.colors.foreground,
    outlineWidth: 0,
  },
  growingInput: { flex: 1, minWidth: 120 },
  // Wraps only once scope chips leave the input less than its minimum width.
  searchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  fileSearchStatus: { width: 14, height: 14, alignItems: "center", justifyContent: "center" },
  results: { flex: 1 },
  // Sections and rows take their height from list-metrics; these styles only place content in it.
  section: { justifyContent: "flex-end" },
  sectionLabel: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: COMMAND_CENTER_SECTION_GAP,
    fontSize: theme.fontSize.sm,
    lineHeight: COMMAND_CENTER_LINE_HEIGHT.sectionLabel,
    color: theme.colors.foregroundMuted,
  },
  sectionDivider: {
    height: 1,
    marginVertical: COMMAND_CENTER_SECTION_GAP,
    backgroundColor: theme.colors.border,
  },
  row: { paddingHorizontal: theme.spacing[4], justifyContent: "center" },
  actionRow: { position: "relative" },
  // Sits over the row's right padding and its reserved trailing slot.
  rowAction: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: theme.spacing[2],
    justifyContent: "center",
  },
  activeRow: { backgroundColor: theme.colors.surface1 },
  rowContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  textContent: { flex: 1, minWidth: 0 },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: COMMAND_CENTER_LINE_HEIGHT.title,
    flexShrink: 1,
  },
  fileLine: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.base,
    lineHeight: COMMAND_CENTER_LINE_HEIGHT.singleLine,
  },
  fileName: { color: theme.colors.foreground },
  filePath: { color: theme.colors.foregroundMuted },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: COMMAND_CENTER_LINE_HEIGHT.subtitle,
  },
  subtitleLine: { flexDirection: "row", minWidth: 0 },
  subtitleText: { flexShrink: 1, minWidth: 0 },
  agentLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minWidth: 0,
    height: COMMAND_CENTER_LINE_HEIGHT.agent,
  },
  agentLineIcon: { width: 12, alignItems: "center", justifyContent: "center" },
  iconSlot: {
    width: 16,
    height: COMMAND_CENTER_LINE_HEIGHT.singleLine,
    alignItems: "center",
    justifyContent: "center",
  },
  projectIconFallbackText: { fontSize: 9 },
  rowShortcut: { flexShrink: 0 },
  breadcrumb: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  breadcrumbPart: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
  },
  breadcrumbGroup: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: COMMAND_CENTER_LINE_HEIGHT.singleLine,
    flexShrink: 0,
  },
  emptyText: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[6],
    textAlign: "center",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  errorText: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.base,
  },
  sheetBackground: { backgroundColor: theme.colors.surface0 },
  sheetHandle: { backgroundColor: theme.colors.palette.zinc[600] },
}));
