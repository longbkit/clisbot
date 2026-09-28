import { useCallback, useEffect } from "react";
import {
  collectAllTabs,
  findPaneById,
  selectIsExplorerSidebarVisible,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { usePanelStore } from "@/stores/panel-store";
import type { WorkspaceTargetContext } from "@/workspace-tabs/model";
import { useConversationExplorerOwner } from "./explorer-owner";
import { withConversationSource } from "./conversation-layout";

function syncExplorer(layoutKey: string, source: WorkspaceTargetContext, isGit: boolean) {
  const store = useWorkspaceLayoutStore.getState();
  const layout = store.layoutByWorkspace[layoutKey];
  const tabs = layout ? collectAllTabs(layout.root) : [];
  const oldId = store.explorerSidebarPaneIdByWorkspace[layoutKey];
  const oldPane = oldId && layout ? findPaneById(layout.root, oldId) : null;
  const selectedKind = tabs.find((tab) => tab.tabId === oldPane?.focusedTabId)?.target.kind;
  for (const tab of tabs) {
    if (
      (tab.target.kind === "files" || tab.target.kind === "changes_tree") &&
      (tab.target.workspaceContext?.workspaceId !== source.workspaceId ||
        (!isGit && tab.target.kind === "changes_tree"))
    )
      store.closeTab(layoutKey, tab.tabId);
  }
  const paneId = useWorkspaceLayoutStore.getState().showExplorerSidebar(layoutKey);
  if (!paneId) return;
  for (const kind of (isGit ? ["files", "changes_tree"] : ["files"]) as (
    | "files"
    | "changes_tree"
  )[]) {
    store.openTab({
      workspaceKey: layoutKey,
      target: withConversationSource({ kind }, source, layoutKey),
      placement: { mode: "pane", paneId },
      intent: "background",
    });
  }
  store.openTab({
    workspaceKey: layoutKey,
    target: withConversationSource(
      { kind: isGit && selectedKind === "changes_tree" ? "changes_tree" : "files" },
      source,
      layoutKey,
    ),
    placement: { mode: "pane", paneId },
    intent: "reveal",
  });
}
export function useConversationExplorer(input: {
  layoutKey: string;
  focused: boolean;
  singlePanel: boolean;
  source: WorkspaceTargetContext | null;
  cwd: string | null;
  isGit: boolean;
}) {
  const { layoutKey, focused, singlePanel, source, cwd, isGit } = input;
  useEffect(() => {
    if (!focused || !singlePanel) return;
    const owner = useConversationExplorerOwner.getState();
    owner.setOwner(layoutKey);
    return () => {
      if (useConversationExplorerOwner.getState().owner === layoutKey) owner.setOwner(null);
      usePanelStore.getState().showMobileAgent();
    };
  }, [focused, layoutKey, singlePanel]);
  useEffect(() => {
    if (!focused) return;
    const store = useWorkspaceLayoutStore.getState();
    if (!source || !cwd) {
      if (singlePanel) usePanelStore.getState().showMobileAgent();
      else store.hideExplorerSidebar(layoutKey);
      return;
    }
    if (singlePanel) {
      const panel = usePanelStore.getState();
      panel.setExplorerTabForCheckout({
        serverId: source.serverId,
        cwd,
        isGit,
        tab: panel.explorerTab,
      });
    } else if (selectIsExplorerSidebarVisible(store, layoutKey))
      syncExplorer(layoutKey, source, isGit);
  }, [cwd, focused, isGit, layoutKey, singlePanel, source]);
  return useCallback(() => {
    if (!source || !cwd) return;
    if (singlePanel)
      usePanelStore.getState().toggleCompactFileExplorer({ serverId: source.serverId, cwd, isGit });
    else if (selectIsExplorerSidebarVisible(useWorkspaceLayoutStore.getState(), layoutKey))
      useWorkspaceLayoutStore.getState().hideExplorerSidebar(layoutKey);
    else syncExplorer(layoutKey, source, isGit);
  }, [cwd, isGit, layoutKey, singlePanel, source]);
}
