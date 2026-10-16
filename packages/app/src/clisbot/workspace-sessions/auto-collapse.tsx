import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useIsChatListDeparting } from "@/clisbot/home/use-chat-list-departure";
import {
  useActiveWorkspaceSelection,
  type ActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";

type AutoCollapseState =
  | { workspaceKey: null; collapsed: false }
  | { workspaceKey: string; collapsed: boolean };

type AutoCollapseAction = { type: "select"; workspaceKey: string | null } | { type: "toggle" };

interface AutoCollapseContextValue {
  collapsedWorkspaceKey: string | null;
  toggle: () => void;
}

const SidebarWorkspaceSelectionContext = createContext<ActiveWorkspaceSelection | null>(null);

export function useSidebarWorkspaceSelection(): ActiveWorkspaceSelection | null {
  return useContext(SidebarWorkspaceSelectionContext);
}

const AutoCollapseContext = createContext<AutoCollapseContextValue | null>(null);

function reduceAutoCollapse(
  state: AutoCollapseState,
  action: AutoCollapseAction,
): AutoCollapseState {
  if (action.type === "select") {
    return { workspaceKey: action.workspaceKey, collapsed: false };
  }
  if (state.workspaceKey === null) return state;
  return { ...state, collapsed: !state.collapsed };
}

/** Shared by the row's press target, selected fill and session list, including pinned rows. */
export function WorkspaceSessionsAutoCollapseProvider({ children }: { children: ReactNode }) {
  const actualSelection = useActiveWorkspaceSelection();
  const pending = useIsChatListDeparting();
  const departing = useIsCompactFormFactor() && pending;
  const serverId = departing ? null : actualSelection?.serverId;
  const workspaceId = departing ? null : actualSelection?.workspaceId;
  const selection = useMemo(
    () => (serverId && workspaceId ? { serverId, workspaceId } : null),
    [serverId, workspaceId],
  );
  const workspaceKey = selection ? `${selection.serverId}:${selection.workspaceId}` : null;
  const [state, dispatch] = useReducer(reduceAutoCollapse, { workspaceKey, collapsed: false });
  // Reset on navigation, including browser history and shortcuts, before rendering the rows.
  if (state.workspaceKey !== workspaceKey) dispatch({ type: "select", workspaceKey });
  const toggle = useCallback(() => dispatch({ type: "toggle" }), []);
  const collapsedWorkspaceKey = state.collapsed ? state.workspaceKey : null;
  const value = useMemo(() => ({ collapsedWorkspaceKey, toggle }), [collapsedWorkspaceKey, toggle]);
  return (
    <SidebarWorkspaceSelectionContext value={selection}>
      <AutoCollapseContext value={value}>{children}</AutoCollapseContext>
    </SidebarWorkspaceSelectionContext>
  );
}

export function useWorkspaceSessionsAutoCollapse(): AutoCollapseContextValue {
  const value = useContext(AutoCollapseContext);
  if (value === null) throw new Error("Workspace sessions require an auto-collapse provider");
  return value;
}
