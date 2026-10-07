import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import type { BotPayload } from "../data/contracts";
import { ChatParticipantSettings } from "./chat-participant-settings";
import { ConversationProjectActions } from "./conversation-project-actions";
import { useConversationProjectContext } from "./conversation-project-context";
import { GroupChatSettings } from "./group-chat-settings";

export type ChatOptionsDetail = "group-settings" | "members" | "project" | null;

const DETAIL_TITLES = {
  "group-settings": "Group settings",
  members: "Members",
  project: "Project",
};

/** The sheet the chat options menu opens: Group settings, Members, Project actions, or an error. */
export function ChatOptionsDetailsSheet({
  active,
  detail,
  error,
  serverId,
  chat,
  bots,
  group,
  offline,
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
  /** The Host is disconnected: membership cannot change. */
  offline: boolean;
  toggleParticipant: (botId: string) => Promise<void>;
  onClose: () => void;
}) {
  const project = useConversationProjectContext();
  const header = useMemo(() => ({ title: detail ? DETAIL_TITLES[detail] : "Chat" }), [detail]);
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
          {detail === "members" && group ? (
            <ChatParticipantSettings
              chat={chat}
              bots={bots}
              disabled={offline}
              toggle={toggleParticipant}
            />
          ) : null}
          {detail === "group-settings" && group ? (
            <GroupChatSettings key={chat.id} serverId={serverId} chat={chat} onSaved={onClose} />
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
