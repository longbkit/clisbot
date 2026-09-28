import { useEffect, useMemo } from "react";
import {
  collectAllPanes,
  collectAllTabs,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { conversationLayoutKey } from "./conversation-layout";
export function useConversationLayout(serverId: string, chatId: string, accessScope: string) {
  const layoutKey = conversationLayoutKey(serverId, chatId, accessScope);
  const layout = useWorkspaceLayoutStore((state) => state.layoutByWorkspace[layoutKey]);
  const tabs = useMemo(() => (layout ? collectAllTabs(layout.root) : []), [layout]);
  const descriptors = useMemo(
    () => tabs.map((tab) => ({ ...tab, key: tab.tabId, kind: tab.target.kind })),
    [tabs],
  );
  const panes = useMemo(() => (layout ? collectAllPanes(layout.root) : []), [layout]);
  const mainTabs = useMemo(
    () => descriptors.filter((tab) => tab.kind !== "files" && tab.kind !== "changes_tree"),
    [descriptors],
  );
  const activeId = panes.find((pane) => pane.id === layout?.focusedPaneId)?.focusedTabId;
  const active = mainTabs.find((tab) => tab.tabId === activeId) ?? mainTabs[0] ?? null;
  useEffect(() => {
    useWorkspaceLayoutStore.getState().openTab({
      workspaceKey: layoutKey,
      target: { kind: "conversation", chatId },
      intent: "background",
    });
  }, [chatId, layoutKey]);
  return { layoutKey, layout, tabs, mainTabs, active };
}
