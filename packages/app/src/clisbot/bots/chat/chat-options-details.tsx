import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ChatPayload } from "@getpaseo/protocol/chats/types";
import { SettingsSection } from "@/components/settings";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import type { BotPayload } from "../data/contracts";
import { ChatParticipantSettings } from "./chat-participant-settings";
import { ConversationProjectActions } from "./conversation-project-actions";
import { useConversationProjectContext } from "./conversation-project-context";
import { GroupChatSettings } from "./group-chat-settings";

export type ChatOptionsDetail = "participants" | "project" | null;

/** The sheet the chat options menu opens: Group settings, Project actions, or an error. */
export function ChatOptionsDetailsSheet({
  active,
  detail,
  error,
  serverId,
  chat,
  bots,
  group,
  busy,
  toggleParticipant,
  onClose,
}: {
  active: boolean;
  detail: ChatOptionsDetail;
  error: string | null;
  serverId: string;
  chat: ChatPayload;
  bots: BotPayload[];
  group: boolean;
  busy: boolean;
  toggleParticipant: (botId: string) => Promise<void>;
  onClose: () => void;
}) {
  const project = useConversationProjectContext();
  const header = useMemo(
    () => ({ title: detail === "project" ? "Project" : "Group settings" }),
    [detail],
  );
  return (
    <AdaptiveModalSheet
      visible={active && (detail !== null || error !== null)}
      header={header}
      onClose={onClose}
    >
      {active ? (
        <View style={styles.body}>
          {detail === "project" && project ? (
            <ConversationProjectActions project={project} onChoose={onClose} />
          ) : null}
          {detail === "participants" && group ? (
            <>
              <ChatParticipantSettings
                chat={chat}
                bots={bots}
                busy={busy}
                toggle={toggleParticipant}
              />
              <SettingsSection title="Details" flush>
                <GroupChatSettings
                  key={chat.id}
                  serverId={serverId}
                  chat={chat}
                  onSaved={onClose}
                />
              </SettingsSection>
            </>
          ) : null}
          {error ? (
            <Text accessibilityRole="alert" style={styles.text}>
              {error}
            </Text>
          ) : null}
        </View>
      ) : null}
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.spacing[3] },
  text: { color: theme.colors.foreground },
}));
