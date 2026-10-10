import { useMemo } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { shallow } from "zustand/shallow";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useSessionStore } from "@/stores/session-store";
import { useSidebarWorkspacesList } from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspacePinController } from "@/hooks/use-sidebar-workspace-pin";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import { useBotCatalog } from "../data/runtime";
import { useBotSidebarActions } from "./use-sidebar-actions";
import { useResourcePins, pinKey, type ResourcePin } from "./pins";
import { resolvePinTarget } from "./pin-target";
export interface PinRow {
  key: string;
  kind: ResourcePin["kind"] | "workspace";
  title: string;
  route: string;
  open?: () => void;
  remove: () => void;
}
type Session = ReturnType<typeof useSessionStore.getState>["sessions"][string];
function usePinMetadata(hostIds: string[]) {
  const maps = useStoreWithEqualityFn(
    useSessionStore,
    (state) =>
      hostIds.flatMap((id) => [state.sessions[id]?.agents, state.sessions[id]?.workspaces]),
    shallow,
  );
  return {
    agents: Object.fromEntries(
      hostIds.map((id, index) => [id, maps[index * 2] as Session["agents"] | undefined]),
    ),
    workspaces: Object.fromEntries(
      hostIds.map((id, index) => [id, maps[index * 2 + 1] as Session["workspaces"] | undefined]),
    ),
  };
}
export function usePinnedRows(onBeforeNavigate?: () => void): {
  rows: PinRow[];
  error: string | null;
} {
  const { projects } = useSidebarWorkspacesList({ hostFilters: [] });
  const { bots, chats } = useBotCatalog();
  const botRows = bots.loadState.status === "loaded" ? bots.loadState.data : [];
  const chatRows = chats.loadState.status === "loaded" ? chats.loadState.data : [];
  const { pins, toggle } = useResourcePins(chatRows);
  const { openBot, error } = useBotSidebarActions(
    chatRows,
    onBeforeNavigate,
    chats.loadState.status === "loaded",
  );
  const hostIds = useMemo(
    () => [...new Set(projects.flatMap((p) => p.hosts.map((h) => h.serverId)))],
    [projects],
  );
  const metadata = usePinMetadata(hostIds);
  const unpinWorkspace = useSidebarWorkspacePinController();
  const nativeOrder = useSidebarOrderStore((state) => state.pinnedWorkspaceOrder);
  const rows = pins.flatMap<PinRow>((pin) => {
    const target = resolvePinTarget(pin, {
      bots: botRows,
      chats: chatRows,
      projects,
      agents: metadata.agents,
    });
    if (!target) return [];
    return [
      {
        ...target,
        key: pinKey(pin),
        kind: pin.kind,
        remove: () => toggle(pin),
        ...(pin.kind === "bot" ? { open: () => void openBot(pin.serverId, pin.id) } : {}),
      },
    ];
  });
  const workspaces = projects
    .flatMap((p) => p.workspaces)
    .flatMap((w) => {
      const descriptor = metadata.workspaces[w.serverId]?.get(w.workspaceId);
      return descriptor?.pinnedAt
        ? [{ ...w, name: descriptor.name, pinnedAt: descriptor.pinnedAt }]
        : [];
    });
  workspaces.sort((a, b) => {
    const ai = nativeOrder.indexOf(a.workspaceKey),
      bi = nativeOrder.indexOf(b.workspaceKey);
    return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi);
  });
  return {
    error,
    rows: [
      ...rows,
      ...workspaces.map((w) => ({
        key: w.workspaceKey,
        kind: "workspace" as const,
        title: w.name,
        route: buildHostWorkspaceRoute(w.serverId, w.workspaceId),
        remove: () => unpinWorkspace(w),
      })),
    ],
  };
}
