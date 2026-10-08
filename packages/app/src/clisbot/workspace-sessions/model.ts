import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useAppSettings, type AppSettings } from "@/hooks/use-settings";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { useWorkspaceSessionsExpansionStore } from "./expansion-store";
import { useWorkspaceSessionsAutoCollapse } from "./auto-collapse";
import type {
  SidebarWorkspaceSessionDetail,
  SidebarWorkspaceSessionExpansion,
  SidebarWorkspaceSessions,
} from "./preferences";
import {
  hasWorkspaceSessionLine,
  listWorkspaceRootAgents,
  selectWorkspaceSessions,
  type WorkspaceSessionItem,
  type WorkspaceSessionSource,
} from "./select-sessions";
import {
  parseShownAgents,
  serializeShownAgents,
  shownAgentIds,
  type ShownAgents,
} from "./shown-agents";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import {
  buildStatusSessionShortcutModel,
  sessionDisplayGroups,
  workspaceStatusDisplayGroups,
  type StatusDisplayGroup,
} from "./status-sessions";
import type { SidebarWorkspaceGroup } from "@/components/sidebar/sidebar-labels";
import type { SidebarProjection } from "@/components/sidebar/sidebar-projection";
import { useSidebarViewStore, type SidebarGroupMode } from "@/stores/sidebar-view-store";
import { listsSessions, resolveSidebarGroupMode } from "./grouping";
import type { SidebarShortcutModel } from "@/utils/sidebar-shortcuts";

const EMPTY_SOURCE: WorkspaceSessionSource = { agents: new Map(), messageSubmissions: new Map() };

interface WorkspaceRef {
  serverId: string;
  workspaceId: string;
  workspaceKey: string;
}

/** The one read of the preference; storage always fills it, so there is no fallback to apply. */
export function useSidebarWorkspaceSessions(): SidebarWorkspaceSessions {
  return useAppSettings().settings.sidebarWorkspaceSessions;
}

export interface WorkspaceSessionsPreferences extends SidebarWorkspaceSessions {
  toggleVisible: () => void;
  setExpansion: (expansion: SidebarWorkspaceSessionExpansion) => void;
  toggleActiveOnly: () => void;
  toggleFullTitles: () => void;
  toggleDetail: (detail: SidebarWorkspaceSessionDetail) => void;
}

export function useWorkspaceSessionsPreferences(): WorkspaceSessionsPreferences {
  const current = useSidebarWorkspaceSessions();
  const { updateSettings } = useAppSettings();
  // Every change reads the stored value inside the updater, so two quick taps apply twice
  // instead of both flipping the value this render happened to see.
  const update = useCallback(
    (patch: (sessions: SidebarWorkspaceSessions) => Partial<SidebarWorkspaceSessions>) => {
      void updateSettings((settings: AppSettings) => ({
        sidebarWorkspaceSessions: {
          ...settings.sidebarWorkspaceSessions,
          ...patch(settings.sidebarWorkspaceSessions),
        },
      }));
    },
    [updateSettings],
  );
  const toggleVisible = useCallback(() => update((s) => ({ visible: !s.visible })), [update]);
  const setExpansion = useCallback(
    (expansion: SidebarWorkspaceSessionExpansion) => update(() => ({ expansion })),
    [update],
  );
  const toggleActiveOnly = useCallback(
    () => update((s) => ({ activeOnly: !s.activeOnly })),
    [update],
  );
  const toggleFullTitles = useCallback(
    () => update((s) => ({ fullTitles: !s.fullTitles })),
    [update],
  );
  const toggleDetail = useCallback(
    (detail: SidebarWorkspaceSessionDetail) =>
      update((s) => ({ details: { ...s.details, [detail]: !s.details[detail] } })),
    [update],
  );

  return useMemo(
    () => ({
      ...current,
      toggleVisible,
      setExpansion,
      toggleActiveOnly,
      toggleFullTitles,
      toggleDetail,
    }),
    [current, toggleVisible, setExpansion, toggleActiveOnly, toggleFullTitles, toggleDetail],
  );
}

/** Whether one workspace row shows its sessions, for a preference the caller already read. */
export function useWorkspaceSessionsExpanded(input: {
  preference: SidebarWorkspaceSessions;
  workspaceKey: string;
  selected: boolean;
}): boolean {
  const { visible, expansion } = input.preference;
  const { collapsedWorkspaceKey } = useWorkspaceSessionsAutoCollapse();
  const manuallyExpanded = useWorkspaceSessionsExpansionStore(
    (state) => state.expandedWorkspaceKeys[input.workspaceKey] === true,
  );
  if (!visible) return false;
  if (expansion === "alwaysExpanded") return true;
  if (expansion === "autoCollapse") {
    return input.selected && collapsedWorkspaceKey !== input.workspaceKey;
  }
  return manuallyExpanded;
}

/** Row presses share the manual chevron's state; Auto collapse only toggles the current row. */
export function useWorkspaceSessionsRowPress(input: {
  workspaceKey: string;
  selected: boolean;
  onPress: () => void;
}): () => void {
  const { visible, expansion } = useSidebarWorkspaceSessions();
  const { toggle } = useWorkspaceSessionsAutoCollapse();
  const { toggle: toggleManual } = useWorkspaceSessionsManualToggle(input.workspaceKey);
  const { selected, onPress } = input;
  return useCallback(() => {
    if (visible && expansion === "manual") {
      toggleManual();
      if (selected) return;
    }
    if (visible && expansion === "autoCollapse" && selected) {
      toggle();
      return;
    }
    onPress();
  }, [visible, expansion, selected, toggleManual, toggle, onPress]);
}

/** State and action shared by the manual chevron and workspace row. */
export function useWorkspaceSessionsManualToggle(workspaceKey: string): {
  expanded: boolean;
  toggle: () => void;
} {
  const expanded = useWorkspaceSessionsExpansionStore(
    (state) => state.expandedWorkspaceKeys[workspaceKey] === true,
  );
  const toggleWorkspaceExpanded = useWorkspaceSessionsExpansionStore(
    (state) => state.toggleWorkspaceExpanded,
  );
  const toggle = useCallback(
    () => toggleWorkspaceExpanded(workspaceKey),
    [toggleWorkspaceExpanded, workspaceKey],
  );
  return { expanded, toggle };
}

/**
 * The session lines for an open workspace. Subscribes to the two maps a line reads rather than
 * the whole store; both are replaced only when an agent or a submission changes, so other store
 * updates, such as timeline items, never re-run the list.
 */
export function useWorkspaceSessions(input: {
  serverId: string;
  workspaceId: string;
  activeOnly: boolean;
  keepAgentIds: ReadonlySet<string>;
}): WorkspaceSessionItem[] {
  const source = useSessionStore(
    useShallow((state) => {
      const session = state.sessions[input.serverId];
      return session
        ? { agents: session.agents, messageSubmissions: session.messageSubmissions }
        : EMPTY_SOURCE;
    }),
  );
  return useMemo(
    () =>
      selectWorkspaceSessions({
        source,
        workspaceId: input.workspaceId,
        activeOnly: input.activeOnly,
        keepAgentIds: input.keepAgentIds,
      }),
    [source, input.workspaceId, input.activeOnly, input.keepAgentIds],
  );
}

/**
 * Whether the workspace has any session at all. Deliberately ignores Active sessions only: the
 * chevron must not appear and vanish as sessions go idle and busy.
 */
export function useWorkspaceHasSessions(input: { serverId: string; workspaceId: string }): boolean {
  const agents = useSessionStore((state) => state.sessions[input.serverId]?.agents);
  return useMemo(
    () => listWorkspaceRootAgents(agents, input.workspaceId).length > 0,
    [agents, input.workspaceId],
  );
}

/**
 * The session in a workspace's focused pane, read once rather than subscribed — for a keyboard
 * shortcut that steps from the session line you are on.
 */
export function readFocusedAgentId(input: {
  serverId: string;
  workspaceId: string;
}): string | undefined {
  const persistenceKey = buildWorkspaceTabPersistenceKey(input);
  if (!persistenceKey) return undefined;
  const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[persistenceKey];
  return parseShownAgents(serializeShownAgents(layout)).selectedAgentId ?? undefined;
}

/** Which agents the workspace is showing; nothing is read while `enabled` is false. */
export function useWorkspaceShownAgents(input: {
  serverId: string;
  workspaceId: string;
  enabled: boolean;
}): ShownAgents {
  const persistenceKey = input.enabled ? buildWorkspaceTabPersistenceKey(input) : null;
  const serialized = useWorkspaceLayoutStore((state) =>
    persistenceKey ? serializeShownAgents(state.layoutByWorkspace[persistenceKey]) : "",
  );
  return useMemo(() => parseShownAgents(serialized), [serialized]);
}

/**
 * Whether a selected workspace row keeps its selected fill.
 *
 * One fill marks where you are. When the session you are in has a line under the row, that line
 * carries the fill and the row gives it up. A workspace showing a terminal, a file, or a session
 * the Active sessions only filter hides has no line to hand it to, so the row keeps it. With
 * Agent sessions off, or the workspace closed, this is plain `selected`, as upstream.
 *
 * The line test runs inside the store selector and returns a boolean, so the upstream row
 * re-renders only when the answer flips — not on every agent change on the server.
 */
export function useWorkspaceRowSelectionFill(input: WorkspaceRef & { selected: boolean }): boolean {
  const preference = useSidebarWorkspaceSessions();
  const expanded = useWorkspaceSessionsExpanded({ ...input, preference });
  const enabled = input.selected && expanded;
  const { selectedAgentId } = useWorkspaceShownAgents({ ...input, enabled });
  const lineSelected = useSessionStore((state) => {
    const session = state.sessions[input.serverId];
    if (!enabled || !selectedAgentId || !session) return false;
    return hasWorkspaceSessionLine({
      source: session,
      workspaceId: input.workspaceId,
      agentId: selectedAgentId,
      activeOnly: preference.activeOnly,
      keepAgentIds: new Set([selectedAgentId]),
    });
  });
  return input.selected && !lineSelected;
}

/** The grouping the sidebar draws: the chosen mode, less the session modes while sessions are off. */
export function useSidebarGroupMode(): SidebarGroupMode {
  const mode = useSidebarViewStore((state) => state.groupMode);
  const { visible } = useSidebarWorkspaceSessions();
  return resolveSidebarGroupMode(mode, visible);
}

/**
 * What a grouped mode lists, and what Cmd+1…9 walk. In the session modes the sessions take their
 * workspace rows' place and the numbers follow those lines; otherwise both are the workspace
 * rows. One result feeds the list and the shortcuts, so a badge never names a line the list does
 * not show.
 */
export function useGroupedSidebarView(input: {
  projection: SidebarProjection;
  groupMode: SidebarGroupMode;
  pinnedCollapsed: boolean;
  collapsedWorkspaceGroupKeys: ReadonlySet<string>;
}): { workspaceGroups: StatusDisplayGroup[]; shortcutModel: SidebarShortcutModel } {
  const { visible, activeOnly } = useSidebarWorkspaceSessions();
  const sessionsShown = visible && listsSessions(input.groupMode);
  const { projection, pinnedCollapsed, collapsedWorkspaceGroupKeys } = input;
  const workspaceGroups = useDisplayGroups({
    groups: projection.workspaceGroups,
    sessionsShown,
    byStatus: input.groupMode === "status",
    activeOnly,
  });
  const shortcutModel = useMemo(
    () =>
      sessionsShown
        ? buildStatusSessionShortcutModel({
            pinnedWorkspaces: projection.pinnedGroups.pinnedChats,
            pinnedCollapsed,
            groups: workspaceGroups,
            collapsedGroupKeys: collapsedWorkspaceGroupKeys,
          })
        : projection.shortcutModel,
    [sessionsShown, projection, pinnedCollapsed, workspaceGroups, collapsedWorkspaceGroupKeys],
  );
  return { workspaceGroups, shortcutModel };
}

/**
 * Reads only the `agents` and `messageSubmissions` maps of the hosts the groups hold, one list
 * each, so the shallow compare skips unrelated store updates.
 */
function useDisplayGroups(input: {
  groups: readonly SidebarWorkspaceGroup[];
  sessionsShown: boolean;
  byStatus: boolean;
  activeOnly: boolean;
}): StatusDisplayGroup[] {
  const { groups, sessionsShown, byStatus, activeOnly } = input;
  const { t } = useTranslation();
  const keepAgentIds = useOpenWorkspaceShownAgentIds(sessionsShown && activeOnly);
  const serverIds = useMemo(
    () => (sessionsShown ? [...new Set(groups.flatMap((g) => g.rows.map((r) => r.serverId)))] : []),
    [sessionsShown, groups],
  );
  const agentMaps = useSessionStore(
    useShallow((state) => serverIds.map((id) => state.sessions[id]?.agents ?? null)),
  );
  const submissionMaps = useSessionStore(
    useShallow((state) => serverIds.map((id) => state.sessions[id]?.messageSubmissions ?? null)),
  );
  return useMemo(() => {
    if (!sessionsShown) return workspaceStatusDisplayGroups(groups);
    const sources = new Map<string, WorkspaceSessionSource>();
    serverIds.forEach((serverId, index) => {
      const agents = agentMaps[index];
      const messageSubmissions = submissionMaps[index];
      if (agents && messageSubmissions) sources.set(serverId, { agents, messageSubmissions });
    });
    return sessionDisplayGroups({ groups, sources, activeOnly, keepAgentIds, byStatus, t });
  }, [
    sessionsShown,
    byStatus,
    activeOnly,
    keepAgentIds,
    groups,
    serverIds,
    agentMaps,
    submissionMaps,
    t,
  ]);
}

/** The sessions the open workspace's panes show; empty outside a workspace or while `enabled` is off. */
function useOpenWorkspaceShownAgentIds(enabled: boolean): ReadonlySet<string> {
  const selection = useActiveWorkspaceSelection();
  const shown = useWorkspaceShownAgents({
    serverId: selection?.serverId ?? "",
    workspaceId: selection?.workspaceId ?? "",
    enabled: enabled && selection !== null,
  });
  return useMemo(() => shownAgentIds(shown), [shown]);
}
