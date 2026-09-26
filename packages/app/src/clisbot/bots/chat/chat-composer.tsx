import { memo, useCallback } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Composer } from "@/composer";
import { useAgentInputDraft } from "@/composer/draft/input-draft";
import type { MessagePayload } from "@/composer/types";
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
  onSubmitMessage: (text: string) => Promise<void>;
}

/**
 * The cowork composer without a live agent: the draft key stands in for the agent id, as the
 * draft launcher does (`screens/new-workspace-screen.tsx`), and the submit goes to the chat
 * (`chat.message.send`) instead of an agent. Agent controls arrive with the direct-chat session.
 */
export const ChatComposer = memo(function ChatComposer({
  serverId,
  chatId,
  placeholder,
  disabled = false,
  onSubmitMessage,
}: ChatComposerProps) {
  const draftKey = buildChatDraftKey(serverId, chatId);
  const draft = useAgentInputDraft({ draftKey });
  const handleSubmit = useCallback(
    async (payload: MessagePayload) => {
      if (payload.attachments?.length)
        throw new Error(
          "Attachments are not supported in Chat yet. Open this bot in cowork to send files.",
        );
      await onSubmitMessage(payload.text);
    },
    [onSubmitMessage],
  );
  return (
    <View style={styles.dock} testID="chat-composer">
      <Composer
        agentId={draftKey}
        serverId={serverId}
        isPaneFocused
        placeholder={placeholder}
        onSubmitMessage={handleSubmit}
        isSubmitLoading={disabled}
        blurOnSubmit={isNative}
        textSource={draft.textSource}
        onChangeText={draft.editText}
        textReplacement={draft.textReplacement}
        attachmentsEnabled={false}
        attachments={draft.attachments}
        onChangeAttachments={draft.setAttachments}
        cwd=""
        clearDraft={draft.clear}
      />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  dock: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[3],
  },
}));
