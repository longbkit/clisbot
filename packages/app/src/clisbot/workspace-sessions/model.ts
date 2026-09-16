import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppSettings, type AppSettings } from "@/hooks/use-settings";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { useWorkspaceSessionsExpansionStore } from "./expansion-store";
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
import { parseShownAgents, serializeShownAgents, type ShownAgents } from "./shown-agents";

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
  const manuallyExpanded = useWorkspaceSessionsExpansionStore(
    (state) => state.expandedWorkspaceKeys[input.workspaceKey] === true,
  );
  if (!visible) return false;
  if (expansion === "alwaysExpanded") return true;
  if (expansion === "autoCollapse") return input.selected;
  return manuallyExpanded;
}

/** The chevron's state; only mounted under `manual`, where the user decides openness. */
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
      }),
    [source, input.workspaceId, input.activeOnly],
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
    });
  });
  return input.selected && !lineSelected;
}
