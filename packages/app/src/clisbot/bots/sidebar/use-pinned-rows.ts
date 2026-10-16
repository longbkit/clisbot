import { useResourcePrincipalScope } from "../data/resource-principal-scope";
import { useMemo } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { shallow } from "zustand/shallow";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useSessionStore } from "@/stores/session-store";
import { useHosts } from "@/runtime/host-runtime";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { useBotCatalog } from "../data/runtime";
import { useBotSidebarActions } from "./use-sidebar-actions";
import { useResourcePins } from "./pins";
import { createPinnedRowsProjector } from "./pinned-row-model";
import type { ChatListAdmission } from "@/clisbot/home/use-chat-list-navigation";
export type { PinRow } from "./pinned-row-model";
const EMPTY_ROWS = [] as const;
type Session = ReturnType<typeof useSessionStore.getState>["sessions"][string];
function usePinMetadata(hostIds: string[]) {
  // Existing accepted Host maps only. Pins neither acquire another directory demand nor repeat
  // the sidebar's complete structure/activity projection. Timeline deltas keep these refs stable.
  const maps = useStoreWithEqualityFn(
    useSessionStore,
    (state) =>
      hostIds.flatMap((id) => {
        const s = state.sessions[id];
        return [
          s?.agents,
          s?.workspaces,
          s?.projects,
          s?.workspaceAgentActivity,
          s?.messageSubmissions,
        ];
      }),
    shallow,
  );
  return useMemo(
    () =>
      Object.fromEntries(
        hostIds.map((id, i) => [
          id,
          {
            agents: maps[i * 5] as Session["agents"] | undefined,
            workspaces: maps[i * 5 + 1] as Session["workspaces"] | undefined,
            projects: maps[i * 5 + 2] as Session["projects"] | undefined,
            workspaceAgentActivity: maps[i * 5 + 3] as
              | Session["workspaceAgentActivity"]
              | undefined,
            messageSubmissions: maps[i * 5 + 4] as Session["messageSubmissions"] | undefined,
          },
        ]),
      ),
    [hostIds, maps],
  );
}

export function usePinnedRows(onBeforeNavigate?: ChatListAdmission) {
  const { allWorkspaceEntriesByKey } = useSidebarModel();
  const hosts = useHosts();
  const hostIds = useMemo(() => hosts.map((h) => h.serverId), [hosts]);
  const metadata = usePinMetadata(hostIds);
  const { bots, chats, hosts: catalogHosts, connectionStatuses } = useBotCatalog();
  const catalogHostIds = useMemo(() => catalogHosts.map((host) => host.serverId), [catalogHosts]);
  const unavailableBots = useUnavailableCatalogHosts(catalogHostIds, connectionStatuses, bots);
  const unavailableChats = useUnavailableCatalogHosts(catalogHostIds, connectionStatuses, chats);
  const botRows = bots.loadState.status === "loaded" ? bots.loadState.data : EMPTY_ROWS;
  const chatRows = chats.loadState.status === "loaded" ? chats.loadState.data : EMPTY_ROWS;
  const { pins, toggle } = useResourcePins(chatRows);
  const scope = useResourcePrincipalScope();
  const projectRows = useMemo(createPinnedRowsProjector, []);
  const { openBot, error } = useBotSidebarActions(
    chatRows,
    onBeforeNavigate,
    chats.loadState.status === "loaded",
  );
  const nativeOrder = useSidebarOrderStore((state) => state.pinnedWorkspaceOrder);
  const rows = useMemo(
    () =>
      projectRows(scope, {
        pins,
        bots: botRows,
        chats: chatRows,
        hostIds,
        metadata,
        workspaceEntries: allWorkspaceEntriesByKey,
        nativeOrder,
        catalogHostIds,
        unavailableBots,
        unavailableChats,
      }),
    [
      projectRows,
      scope,
      pins,
      botRows,
      chatRows,
      hostIds,
      metadata,
      allWorkspaceEntriesByKey,
      nativeOrder,
      catalogHostIds,
      unavailableBots,
      unavailableChats,
    ],
  );
  return { rows, error, chats: chatRows, openBot, toggle };
}

function useUnavailableCatalogHosts(
  hosts: readonly string[],
  statuses: ReadonlyMap<string, string>,
  catalog: {
    loadState: { status: string };
    isError: boolean;
    hostErrors: readonly { serverId: string }[];
    acceptedServerIds: readonly string[];
  },
) {
  const {
    loadState: { status },
    isError,
    hostErrors,
    acceptedServerIds,
  } = catalog;
  return useMemo(
    () =>
      new Set(
        hosts.filter(
          (id) =>
            !acceptedServerIds.includes(id) ||
            statuses.get(id) !== "online" ||
            status !== "loaded" ||
            isError ||
            hostErrors.some((error) => error.serverId === id),
        ),
      ),
    [hosts, statuses, status, isError, hostErrors, acceptedServerIds],
  );
}
