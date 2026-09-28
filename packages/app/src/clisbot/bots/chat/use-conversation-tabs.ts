import { useOpenConversationFile } from "./use-open-conversation-file";
import { useCallback } from "react";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspacePaneContentModel } from "@/screens/workspace/workspace-pane-content";
import { createWorkspaceFileTabTarget } from "@/workspace/file-open";
import { confirmPanelClose } from "@/panels/confirm-panel-close";
import type {
  WorkspaceTab,
  WorkspaceTabTarget,
  WorkspaceTargetContext,
} from "@/workspace-tabs/model";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { ChatBotIdentity } from "./chat-rows";
import { ConversationResourcePanel, isConversationDocumentTarget } from "./conversation-access";
import { withConversationSource } from "./conversation-layout";

export function useConversationTabs(input: {
  serverId: string;
  bots: readonly ChatBotIdentity[];
  layoutKey: string;
  singlePanel: boolean;
  tabs: WorkspaceTab[];
  selectBot: (id: string) => void;
}) {
  const { serverId, bots, layoutKey, singlePanel, tabs, selectBot } = input;
  const open = useOpenConversationFile({ serverId, bots, layoutKey, singlePanel, selectBot });
  const closeTab = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((candidate) => candidate.tabId === tabId);
      if (!tab || tab.target.kind === "conversation") return;
      const origin = tab.target.workspaceContext;
      if (
        origin &&
        !(await confirmPanelClose(
          { ...origin, tabId },
          {
            title: "Unsaved changes",
            message: "Close this tab without saving your changes?",
            confirmLabel: "Close without saving",
            cancelLabel: "Keep editing",
            destructive: true,
          },
        ))
      )
        return;
      useWorkspaceLayoutStore.getState().closeTab(layoutKey, tabId);
    },
    [layoutKey, tabs],
  );
  const buildContent = useCallback(
    ({ tab }: { tab: WorkspaceTabDescriptor; paneId: string }) =>
      buildContentModel({ tab, serverId, layoutKey, open, closeTab }),
    [closeTab, layoutKey, open, serverId],
  );
  const selectTab = useCallback(
    (id: string) => useWorkspaceLayoutStore.getState().focusTab(layoutKey, id),
    [layoutKey],
  );
  const bulkClose = useCallback(
    async (ids: string[]) => {
      for (const id of ids) await closeTab(id);
    },
    [closeTab],
  );
  return { open, closeTab, buildContent, selectTab, bulkClose };
}
function buildContentModel({
  tab,
  serverId,
  layoutKey,
  open,
  closeTab,
}: {
  tab: WorkspaceTabDescriptor;
  serverId: string;
  layoutKey: string;
  open: (origin: WorkspaceTargetContext, target: WorkspaceTabTarget) => void;
  closeTab: (id: string) => Promise<void>;
}) {
  const origin = tab.target.workspaceContext;
  const openTarget = (target: WorkspaceTabTarget) => {
    if (origin) open(origin, target);
  };
  const content = buildWorkspacePaneContentModel({
    tab,
    normalizedServerId: origin?.serverId ?? serverId,
    normalizedWorkspaceId: origin?.workspaceId ?? "",
    host: tab.kind === "files" || tab.kind === "changes_tree" ? "explorer" : "main",
    onOpenTab: openTarget,
    onOpenPreferredTarget: openTarget,
    onOpenTargetToSide: openTarget,
    onCloseCurrentTab: () => {
      void closeTab(tab.tabId);
    },
    onRetargetCurrentTab: (target) => {
      if (origin && isConversationDocumentTarget(target))
        useWorkspaceLayoutStore
          .getState()
          .replaceTab(layoutKey, tab.tabId, withConversationSource(target, origin, layoutKey));
    },
    onSetCurrentTabState: (state) =>
      useWorkspaceLayoutStore.getState().setTabState(layoutKey, tab.tabId, state),
    onOpenWorkspaceFile: (request) => openTarget(createWorkspaceFileTabTarget(request.location)),
    onOpenImportSheet: () => {},
  });
  return tab.kind === "conversation"
    ? content
    : { ...content, Component: ConversationResourcePanel };
}
