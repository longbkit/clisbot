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
import { buildPinnedRows } from "./pinned-row-model";
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

export function usePinnedRows(onBeforeNavigate?: (destination?: string) => void) {
  const { allWorkspaceEntriesByKey } = useSidebarModel();
  const hosts = useHosts();
  const hostIds = useMemo(() => hosts.map((h) => h.serverId), [hosts]);
  const metadata = usePinMetadata(hostIds);
  const { bots, chats } = useBotCatalog();
  const botRows = bots.loadState.status === "loaded" ? bots.loadState.data : EMPTY_ROWS;
  const chatRows = chats.loadState.status === "loaded" ? chats.loadState.data : EMPTY_ROWS;
  const { pins } = useResourcePins(chatRows);
  const { openBot, error } = useBotSidebarActions(
    chatRows,
    onBeforeNavigate,
    chats.loadState.status === "loaded",
  );
  const nativeOrder = useSidebarOrderStore((state) => state.pinnedWorkspaceOrder);
  const rows = useMemo(
    () =>
      buildPinnedRows({
        pins,
        bots: botRows,
        chats: chatRows,
        hostIds,
        metadata,
        workspaceEntries: allWorkspaceEntriesByKey,
        nativeOrder,
      }),
    [pins, botRows, chatRows, hostIds, metadata, allWorkspaceEntriesByKey, nativeOrder],
  );
  return { rows, error, chats: chatRows, openBot };
}
