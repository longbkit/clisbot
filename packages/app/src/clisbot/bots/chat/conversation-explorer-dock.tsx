import { useCallback, type ComponentProps, type Dispatch, type SetStateAction } from "react";
import { ExplorerSidebarDock } from "@/screens/workspace/explorer-sidebar";
import { ExplorerFrame } from "@/screens/workspace/explorer-sidebar/frame";
import {
  findPaneById,
  selectExplorerSidebarPaneId,
  selectIsExplorerSidebarVisible,
  useWorkspaceLayoutStore,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-store";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { conversationClipboardActions } from "./conversation-tab-actions";
import type { useConversationTabs } from "./use-conversation-tabs";

type DockProps = ComponentProps<typeof ExplorerSidebarDock>;
const EMPTY_CLOSING = new Set<string>();
const noop = () => {};

/**
 * A chat's Files and changes pane on desktop. The split container draws only the main panes, so
 * the chat docks the Explorer pane beside it in the same frame a workspace uses.
 */
export function ConversationExplorerDock({
  serverId,
  focused,
  layoutKey,
  layout,
  tabs,
  actions,
  hovered,
  setHovered,
  closeActions,
  containerWidth,
  openExplorer,
}: {
  serverId: string;
  focused: boolean;
  layoutKey: string;
  layout: WorkspaceLayout;
  tabs: WorkspaceTab[];
  actions: ReturnType<typeof useConversationTabs>;
  hovered: string | null;
  setHovered: Dispatch<SetStateAction<string | null>>;
  closeActions: Pick<
    DockProps,
    "onCloseTabsToLeft" | "onCloseTabsToRight" | "onCloseOtherTabs" | "onReorderTabsInPane"
  >;
  containerWidth: number;
  openExplorer: () => void;
}) {
  const paneId = useWorkspaceLayoutStore((state) => selectExplorerSidebarPaneId(state, layoutKey));
  const open = useWorkspaceLayoutStore((state) => selectIsExplorerSidebarVisible(state, layoutKey));
  const selectTab = useCallback(
    (id: string, tabId: string) =>
      useWorkspaceLayoutStore.getState().selectTabInPane(layoutKey, id, tabId),
    [layoutKey],
  );
  const pane = findPaneById(layout.root, paneId);
  if (!pane) return null;
  return (
    <ExplorerFrame
      presentation="dock"
      isWorkspaceActive={focused}
      persistenceKey={layoutKey}
      containerWidth={containerWidth}
      isOpen={open}
    >
      <ExplorerSidebarDock
        {...conversationClipboardActions}
        {...closeActions}
        pane={pane}
        uiTabs={tabs}
        normalizedServerId={serverId}
        normalizedWorkspaceId=""
        isWorkspaceFocused={focused}
        closingTabIds={EMPTY_CLOSING}
        hoveredCloseTabKey={hovered}
        setHoveredCloseTabKey={setHovered}
        onSelectTab={selectTab}
        onCloseTab={actions.closeTab}
        onCreateNewTab={openExplorer}
        onExitFocusMode={noop}
        buildPaneContentModel={actions.buildContent}
      />
    </ExplorerFrame>
  );
}
