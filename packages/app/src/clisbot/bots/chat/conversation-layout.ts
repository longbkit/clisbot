import type { WorkspaceTabTarget, WorkspaceTargetContext } from "@/workspace-tabs/model";
import { openWorkspaceTargetAtLocation } from "@/workspace-tabs/open-beside";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";

export function conversationLayoutKey(serverId: string, chatId: string, accessScope: string) {
  return `conversation:${JSON.stringify([serverId, chatId, accessScope])}`;
}
export function withConversationSource(
  target: WorkspaceTabTarget,
  source: WorkspaceTargetContext,
  layoutScope: string,
): WorkspaceTabTarget {
  return {
    ...target,
    layoutScope,
    workspaceContext: { serverId: source.serverId, workspaceId: source.workspaceId },
  };
}
/** Layout identity is conversation-owned; RPC identity is always the original bot workspace. */
export function openConversationFile(input: {
  layoutKey: string;
  source: WorkspaceTargetContext;
  target: WorkspaceTabTarget;
  compact: boolean;
}) {
  const target = withConversationSource(input.target, input.source, input.layoutKey);
  if (target.kind === "files" || target.kind === "changes_tree") {
    const store = useWorkspaceLayoutStore.getState();
    const paneId = store.showExplorerSidebar(input.layoutKey);
    return store.openTab({
      workspaceKey: input.layoutKey,
      target,
      intent: "reveal",
      placement: paneId ? { mode: "prefer", paneId } : undefined,
    });
  }
  return openWorkspaceTargetAtLocation({
    workspaceKey: input.layoutKey,
    target,
    isCompact: input.compact,
    location: "side",
  });
}
