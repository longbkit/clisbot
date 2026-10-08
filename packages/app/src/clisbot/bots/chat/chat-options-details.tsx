import { useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
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

function detailTitle(t: TFunction, detail: ChatOptionsDetail): string {
  if (detail === "group-settings") return t("bots.chat.common.groupSettings");
  if (detail === "members") return t("bots.chat.common.members");
  if (detail === "project") return t("bots.chat.common.project");
  return t("bots.chat.common.chat");
}

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
  const { t } = useTranslation();
  const project = useConversationProjectContext();
  const header = useMemo(() => ({ title: detailTitle(t, detail) }), [detail, t]);
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
