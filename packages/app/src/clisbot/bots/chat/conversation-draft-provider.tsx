import { useMemo, type ReactNode } from "react";
import { ConversationDraftContext } from "./conversation-draft-context";
import { buildChatDraftKey } from "./chat-composer";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { usePanelStore } from "@/stores/panel-store";
export function ConversationDraftProvider({
  serverId,
  chatId,
  layoutKey,
  children,
}: {
  serverId: string;
  chatId: string;
  layoutKey: string;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      draftKey: buildChatDraftKey(serverId, chatId),
      focusMessages: () => {
        const store = useWorkspaceLayoutStore.getState();
        const layout = store.layoutByWorkspace[layoutKey];
        const tab =
          layout && collectAllTabs(layout.root).find((item) => item.target.kind === "conversation");
        if (tab) store.focusTab(layoutKey, tab.tabId);
        usePanelStore.getState().showMobileAgent();
      },
    }),
    [serverId, chatId, layoutKey],
  );
  return (
    <ConversationDraftContext.Provider value={value}>{children}</ConversationDraftContext.Provider>
  );
}
