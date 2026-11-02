import { type ReactNode, useCallback } from "react";
import { View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useOpenFileExplorerGesture } from "@/mobile-panels/gestures";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import { showExplorerSidebar } from "@/workspace-tabs/explorer-sidebar";
import { isWeb } from "@/constants/platform";
import { useConversationExplorerOwner } from "@/clisbot/bots/chat/explorer-owner";
import { usePanelStore } from "@/stores/panel-store";

interface CompactExplorerOpenGestureSurfaceProps {
  children: ReactNode;
  enabled: boolean;
  onOpenExplorer: () => void;
}

const COMPACT_WEB_GESTURE_TOUCH_ACTION = isWeb ? "auto" : "pan-y";

function CompactExplorerOpenGestureSurface({
  children,
  enabled,
  onOpenExplorer,
}: CompactExplorerOpenGestureSurfaceProps) {
  const explorerOpenGesture = useOpenFileExplorerGesture({
    enabled,
    onOpen: onOpenExplorer,
  });

  return (
    <GestureDetector gesture={explorerOpenGesture} touchAction={COMPACT_WEB_GESTURE_TOUCH_ACTION}>
      <View style={styles.fill}>{children}</View>
    </GestureDetector>
  );
}

export function WorkspaceExplorerOpenGesture({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const selection = useActiveWorkspaceSelection();
  const workspace = useWorkspace(selection?.serverId ?? null, selection?.workspaceId ?? null);
  // A Bot chat is not a workspace route; it owns its Explorer overlay while it can open.
  const conversationOpenable = useConversationExplorerOwner((state) => state.openable !== null);
  const handleOpen = useCallback(() => {
    if (selection && workspace) {
      showExplorerSidebar({
        isCompact: true,
        workspaceKey: `${selection.serverId}:${selection.workspaceId}`,
      });
      return;
    }
    if (useConversationExplorerOwner.getState().openable !== null)
      usePanelStore.getState().showMobileFileExplorer();
  }, [selection, workspace]);
  return (
    <CompactExplorerOpenGestureSurface
      enabled={enabled && (Boolean(workspace) || conversationOpenable)}
      onOpenExplorer={handleOpen}
    >
      {children}
    </CompactExplorerOpenGestureSurface>
  );
}
const styles = { fill: { flex: 1 } };
