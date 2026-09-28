import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { useConversationDraftContext } from "@/clisbot/bots/chat/conversation-draft-context";
import { useIsConversationShell } from "@/clisbot/bots/chat/conversation-shell-context";
import { useCallback, useMemo } from "react";
import { createWorkspaceFileAttachment } from "@/attachments/workspace-file";
import { resolveFocusedChatTarget } from "@/composer/focused-chat-target";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

export function useAddFileToChat(input: { serverId: string; workspaceId?: string | null }) {
  const sourceDirectory = useWorkspaceDirectory(input.serverId, input.workspaceId ?? null);
  const conversation = useConversationDraftContext();
  const inConversation = useIsConversationShell();
  const workspaceKey = input.workspaceId
    ? buildWorkspaceTabPersistenceKey({ serverId: input.serverId, workspaceId: input.workspaceId })
    : null;
  const layout = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined,
  );
  const focusTab = useWorkspaceLayoutStore((state) => state.focusTab);
  const focusedChat = useMemo(
    () => resolveFocusedChatTarget({ serverId: input.serverId, layout }),
    [input.serverId, layout],
  );
  const addFile = useCallback(
    async (filePath: string) => {
      if (conversation) {
        await useDraftStore.getState().attachWorkspaceFile({
          draftKey: conversation.draftKey,
          attachment: createWorkspaceFileAttachment({
            path:
              /^(?:\/|[A-Za-z]:[\\/])/.test(filePath) || !sourceDirectory
                ? filePath
                : `${sourceDirectory.replace(/[\\/]$/, "")}/${filePath}`,
          }),
        });
        conversation.focusMessages();
        return;
      }
      if (inConversation || !focusedChat || !workspaceKey) {
        return;
      }
      await useDraftStore.getState().attachWorkspaceFile({
        draftKey: focusedChat.draftKey,
        attachment: createWorkspaceFileAttachment({ path: filePath }),
      });
      focusTab(workspaceKey, focusedChat.tabId);
    },
    [focusTab, focusedChat, workspaceKey, inConversation, conversation, sourceDirectory],
  );
  return {
    addFile,
    canAddToChat: conversation !== null || (!inConversation && focusedChat !== null),
  };
}
