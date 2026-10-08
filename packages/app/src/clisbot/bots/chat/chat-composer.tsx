import { useSessionStore } from "@/stores/session-store";
import { useConversationProjectContext } from "./conversation-project-context";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { conversationFilePath } from "./source-file-path";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Composer } from "@/composer";
import { useAgentInputDraft } from "@/composer/draft/input-draft";
import type { MessagePayload } from "@/composer/types";
import type { MentionMember } from "./member-mentions";
import { isNative } from "@/constants/platform";

/** `useAgentInputDraft` takes any string key (plans/app.md R5); one draft per chat per host. */
export function buildChatDraftKey(serverId: string, chatId: string): string {
  return `chat:${serverId}:${chatId}`;
}

interface ChatComposerProps {
  serverId: string;
  chatId: string;
  placeholder: string;
  /** Sending is disabled while the host is not online or a send is in flight. */
  disabled?: boolean;
  onSubmitMessage: (payload: MessagePayload) => Promise<void>;
  /** Group members the `@` picker offers; none in a direct chat. */
  mentionMembers?: readonly MentionMember[];
}

/**
 * Shared composer with a conversation-owned draft and canonical chat submit.
 * Session controls refer to the explicitly selected participant.
 */
export const ChatComposer = memo(function ChatComposer({
  serverId,
  chatId,
  placeholder,
  disabled = false,
  onSubmitMessage,
  mentionMembers,
}: ChatComposerProps) {
  const { t } = useTranslation();
  const attachmentsSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.bots === true,
  );
  const active = useRetainedPanelActive();
  const draftKey = buildChatDraftKey(serverId, chatId);
  const draft = useAgentInputDraft({ draftKey });
  const project = useConversationProjectContext();
  const resolveWorkspaceFilePath = useCallback(
    (path: string) => conversationFilePath(project?.cwd, path),
    [project?.cwd],
  );
  return (
    <View style={styles.dock} testID="chat-composer">
      <Composer
        agentId={project?.agentId ?? draftKey}
        workspaceId={project?.workspaceId}
        submissionTarget="conversation"
        resolveWorkspaceFilePath={resolveWorkspaceFilePath}
        mentionMembers={mentionMembers}
        // One `bots` gate covers attachments and canonical spoken-input routing.
        realtimeVoiceEnabled={attachmentsSupported}
        showAgentControls={project?.canConfigure === true}
        pendingSessionReason={
          !project?.agentId ? t("bots.chat.composer.pendingSession") : undefined
        }
        serverId={serverId}
        isPaneFocused={active}
        // Opening a bot DM or a group lands in the message field, as an agent session does;
        // the Composer only honors it at the desktop breakpoint, so phones keep the keyboard down.
        autoFocus
        autoFocusKey={chatId}
        placeholder={placeholder}
        onSubmitMessage={onSubmitMessage}
        isSubmitLoading={disabled}
        blurOnSubmit={isNative}
        textSource={draft.textSource}
        onChangeText={draft.editText}
        textReplacement={draft.textReplacement}
        attachmentsEnabled={attachmentsSupported}
        attachments={draft.attachments}
        onChangeAttachments={draft.setAttachments}
        cwd={project?.cwd ?? ""}
        clearDraft={draft.clear}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  dock: {
    width: "100%",
    flexShrink: 1,
  },
});
