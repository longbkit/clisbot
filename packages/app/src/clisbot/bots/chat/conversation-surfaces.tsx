import { useState, useMemo, type ComponentProps, type ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import * as Clipboard from "expo-clipboard";
import { SplitContainer } from "@/components/split-container";
import {
  CompactExplorerSidebar,
  NativeExplorerSidebarDock,
} from "@/components/compact-explorer-sidebar";
import { WorkspacePanelHost } from "@/screens/workspace/workspace-panel-host";
import { MobileWorkspaceTabSwitcher } from "@/screens/workspace/workspace-screen";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import type { useConversationLayout } from "./use-conversation-layout";
import type { useConversationTabs } from "./use-conversation-tabs";
import type { useConversationProject } from "./use-conversation-project";
const noop = () => {};
const EMPTY_CLOSING = new Set<string>();
const fill = { flex: 1, minHeight: 0, minWidth: 0 } as const;
const copy = async (value: string) => {
  await Clipboard.setStringAsync(value);
};
type TabState = ReturnType<typeof useConversationLayout>;
type TabActions = ReturnType<typeof useConversationTabs>;
interface SurfaceProps {
  serverId: string;
  focused: boolean;
  state: TabState;
  actions: TabActions;
  header: () => ReactNode;
}
const clipboardActions = {
  onCopyResumeCommand: noop,
  onCopyAgentId: copy,
  onCopyTerminalId: copy,
  onCopyFilePath: copy,
  onReloadAgent: noop,
  onRenameTab: noop,
};
export function DesktopConversationSurface({
  serverId,
  focused,
  state,
  actions,
  header,
  openExplorer,
}: SurfaceProps & { openExplorer: () => void }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const splitActions = useDesktopActions(state.layoutKey, actions.bulkClose);
  if (!state.layout) return null;
  const { layoutKey, layout, tabs } = state;
  return (
    <SplitContainer
      {...clipboardActions}
      {...splitActions}
      layout={layout}
      workspaceKey={layoutKey}
      normalizedServerId={serverId}
      normalizedWorkspaceId=""
      isWorkspaceFocused={focused}
      uiTabs={tabs}
      renderMainHeader={header}
      hoveredCloseTabKey={hovered}
      setHoveredCloseTabKey={setHovered}
      closingTabIds={EMPTY_CLOSING}
      onNavigateTab={actions.selectTab}
      onCloseTab={actions.closeTab}
      onCreateNewTab={openExplorer}
      buildPaneContentModel={actions.buildContent}
      onExitFocusMode={noop}
    />
  );
}
function ConversationSwitcher({
  serverId,
  state,
  actions,
}: Pick<SurfaceProps, "serverId" | "state" | "actions">) {
  const { mainTabs, active } = state;
  const closeActions = useMemo(
    () => ({
      onCloseTabsAbove: (id: string) =>
        actions.bulkClose(
          mainTabs
            .slice(
              0,
              mainTabs.findIndex((tab) => tab.tabId === id),
            )
            .map((tab) => tab.tabId),
        ),
      onCloseTabsBelow: (id: string) =>
        actions.bulkClose(
          mainTabs.slice(mainTabs.findIndex((tab) => tab.tabId === id) + 1).map((tab) => tab.tabId),
        ),
      onCloseOtherTabs: (id: string) =>
        actions.bulkClose(mainTabs.filter((tab) => tab.tabId !== id).map((tab) => tab.tabId)),
    }),
    [actions, mainTabs],
  );
  return (
    <MobileWorkspaceTabSwitcher
      {...clipboardActions}
      tabs={mainTabs}
      activeTabKey={active?.key ?? ""}
      activeTab={active}
      tabByKey={new Map(mainTabs.map((tab) => [tab.key, tab]))}
      tabSwitcherOptions={mainTabs.map((tab) => {
        let label = "Changes";
        if (tab.kind === "conversation") label = "Messages";
        if (tab.target.kind === "file") label = tab.target.path;
        return { id: tab.key, label };
      })}
      normalizedServerId={serverId}
      normalizedWorkspaceId=""
      onSelectSwitcherTab={actions.selectTab}
      onCloseTab={actions.closeTab}
      {...closeActions}
    />
  );
}
export function MobileConversationSurface({
  serverId,
  focused,
  state,
  actions,
  header,
  project,
  selector,
  compact,
}: SurfaceProps & {
  project: ReturnType<typeof useConversationProject>;
  selector: ReactNode;
  compact: boolean;
}) {
  const { width } = useWindowDimensions();
  const explorer =
    project.source && project.cwd && focused
      ? {
          serverId,
          workspaceId: project.source.workspaceId,
          workspaceRoot: project.cwd,
          isGit: project.isGit,
          contextControls: selector,
          onOpenFile: (path: string) => actions.open(project.source!, { kind: "file", path }),
        }
      : null;
  return (
    <View style={[fill, { flexDirection: "row" }]}>
      <View style={fill}>
        {header()}
        <ConversationSwitcher serverId={serverId} state={state} actions={actions} />
        <View style={fill}>
          <WorkspacePanelHost
            paneId="conversation-mobile"
            tabs={state.mainTabs}
            activeTabId={state.active?.tabId ?? null}
            normalizedServerId={serverId}
            normalizedWorkspaceId=""
            isWorkspaceFocused={focused}
            isPaneFocused
            buildPaneContentModel={actions.buildContent}
          />
        </View>
        {explorer && compact ? <CompactExplorerSidebar {...explorer} /> : null}
      </View>
      {explorer && !compact ? (
        <NativeExplorerSidebarDock
          {...explorer}
          persistenceKey={state.layoutKey}
          containerWidth={width}
        />
      ) : null}
    </View>
  );
}

type SplitActions = Pick<
  ComponentProps<typeof SplitContainer>,
  | "onCloseTabsToLeft"
  | "onCloseTabsToRight"
  | "onCloseOtherTabs"
  | "onFocusPane"
  | "onSplitPane"
  | "onSplitPaneEmpty"
  | "onMoveTabToPane"
  | "onSelectTabInPane"
  | "onResizeSplit"
  | "onReorderTabsInPane"
>;
function useDesktopActions(layoutKey: string, bulkClose: TabActions["bulkClose"]) {
  return useMemo<SplitActions>(() => {
    const store = useWorkspaceLayoutStore.getState();
    return {
      onCloseTabsToLeft: (id, items) =>
        bulkClose(
          items
            .slice(
              0,
              items.findIndex((tab) => tab.tabId === id),
            )
            .map((tab) => tab.tabId),
        ),
      onCloseTabsToRight: (id, items) =>
        bulkClose(
          items.slice(items.findIndex((tab) => tab.tabId === id) + 1).map((tab) => tab.tabId),
        ),
      onCloseOtherTabs: (id, items) =>
        bulkClose(items.filter((tab) => tab.tabId !== id).map((tab) => tab.tabId)),
      onFocusPane: (id) => store.focusPane(layoutKey, id),
      onSplitPane: (input) => store.splitPane(layoutKey, input),
      onSplitPaneEmpty: (input) => store.splitPaneEmpty(layoutKey, input),
      onMoveTabToPane: (id, pane) => store.moveTabToPane(layoutKey, id, pane),
      onSelectTabInPane: (pane, id) => store.selectTabInPane(layoutKey, pane, id),
      onResizeSplit: (id, sizes) => store.resizeSplit(layoutKey, id, sizes),
      onReorderTabsInPane: (id, ids) => store.reorderTabsInPane(layoutKey, id, ids),
    };
  }, [bulkClose, layoutKey]);
}
