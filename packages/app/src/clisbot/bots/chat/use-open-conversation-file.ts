import { useCallback } from "react";
import { useSessionStore } from "@/stores/session-store";
import { selectWorkspace } from "@/stores/session-store-hooks/selectors";
import { usePanelStore } from "@/stores/panel-store";
import type { WorkspaceTabTarget, WorkspaceTargetContext } from "@/workspace-tabs/model";
import type { ChatBotIdentity } from "./chat-rows";
import { isConversationDocumentTarget } from "./conversation-access";
import { openConversationFile } from "./conversation-layout";
export function useOpenConversationFile({
  serverId,
  bots,
  layoutKey,
  singlePanel,
  selectBot,
}: {
  serverId: string;
  bots: readonly ChatBotIdentity[];
  layoutKey: string;
  singlePanel: boolean;
  selectBot: (id: string) => void;
}) {
  const open = useCallback(
    (origin: WorkspaceTargetContext, target: WorkspaceTabTarget) => {
      if (
        !isConversationDocumentTarget(target) ||
        origin.serverId !== serverId ||
        !bots.some((bot) => bot.workspaceId === origin.workspaceId)
      )
        return;
      const workspace = selectWorkspace(
        useSessionStore.getState(),
        origin.serverId,
        origin.workspaceId,
      );
      if (!workspace) return;
      if (target.kind === "files" || target.kind === "changes_tree") {
        const bot = bots.find((candidate) => candidate.workspaceId === origin.workspaceId);
        if (bot) selectBot(bot.botId);
        if (singlePanel) {
          const isGit = workspace.projectKind === "git";
          usePanelStore.getState().setExplorerTabForCheckout({
            serverId: origin.serverId,
            cwd: workspace.workspaceDirectory,
            isGit,
            tab: target.kind === "changes_tree" ? "changes" : "files",
          });
          usePanelStore.getState().openCompactFileExplorer({
            serverId: origin.serverId,
            cwd: workspace.workspaceDirectory,
            isGit,
          });
          return;
        }
      }
      openConversationFile({ layoutKey, source: origin, target, compact: singlePanel });
      if (singlePanel) usePanelStore.getState().showMobileAgent();
    },
    [bots, layoutKey, serverId, singlePanel, selectBot],
  );
  return open;
}
