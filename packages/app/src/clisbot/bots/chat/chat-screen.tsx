import { useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { botsCopy } from "../copy";
import type { ChatMessage } from "../data/contracts";
import { ChatComposer } from "./chat-composer";
import { ChatList } from "./chat-list";
import type { RespondToPermission } from "./chat-live-row";
import type { ChatBotIdentity } from "./chat-rows";
import { buildChatRenderModel, type ChatLiveHead } from "./render-model";

export interface ChatScreenProps {
  serverId: string;
  chatId: string;
  title: string;
  /** The chat's participants, in order. */
  bots: readonly ChatBotIdentity[];
  transcript: readonly ChatMessage[];
  liveHeads: ReadonlyMap<string, ChatLiveHead>;
  /** False while the host is offline: the composer will not send. */
  canSend?: boolean;
  onSubmitMessage: (text: string) => Promise<void>;
  onRespondPermission?: RespondToPermission;
  onReachTop?: () => void;
  headerRight?: ReactNode;
}

/**
 * Header, list, composer. Data comes in as props: the route file's screen (next wave) gates on
 * the `bots` feature, then feeds this from the chat, transcript and session selectors
 * (plans/app.md §4 "Screen composition").
 */
export function ChatScreen({
  serverId,
  chatId,
  title,
  bots,
  transcript,
  liveHeads,
  canSend = true,
  onSubmitMessage,
  onRespondPermission,
  onReachTop,
  headerRight,
}: ChatScreenProps) {
  const model = useMemo(() => buildChatRenderModel(transcript, liveHeads), [liveHeads, transcript]);
  const botsById = useMemo(() => new Map(bots.map((bot) => [bot.botId, bot] as const)), [bots]);
  const placeholder =
    bots.length === 1 && bots[0] ? botsCopy.messageBot(bots[0].name) : botsCopy.messagePlaceholder;
  return (
    <View style={styles.container} testID={`chat-screen-${chatId}`}>
      <MenuHeader title={title} rightContent={headerRight} />
      <ChatList
        rows={model.rows}
        serverId={serverId}
        bots={botsById}
        onRespondPermission={onRespondPermission}
        onReachTop={onReachTop}
      />
      <ChatComposer
        serverId={serverId}
        chatId={chatId}
        placeholder={placeholder}
        disabled={!canSend}
        onSubmitMessage={onSubmitMessage}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, backgroundColor: theme.colors.surface0 },
}));
