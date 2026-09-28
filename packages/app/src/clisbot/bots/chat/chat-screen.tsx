import type { MessagePayload } from "@/composer/types";
import { ToolCallSheetProvider } from "@/components/tool-call-sheet";
import { ComposerDock } from "@/composer/dock";
import { useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { botsCopy } from "../copy";
import type { ChatMessage } from "../data/contracts";
import { ChatComposer } from "./chat-composer";
import { mentionMembersOf } from "./member-mentions";
import { ChatList } from "./chat-list";
import type { ChatBotIdentity } from "./chat-rows";
import { buildChatRenderModel, type ChatLiveHead } from "./render-model";

export interface ChatScreenProps {
  serverId: string;
  chatId: string;
  title: string;
  /** The chat's participants, in order. */
  bots: readonly ChatBotIdentity[];
  /** A group chat: the composer's `@` picker offers the members. */
  group?: boolean;
  transcript: readonly ChatMessage[];
  liveHeads: ReadonlyMap<string, ChatLiveHead>;
  /** False while the host is offline: the composer will not send. */
  canSend?: boolean;
  onSubmitMessage: (payload: MessagePayload) => Promise<void>;
  onReachTop?: () => void;
  headerRight?: ReactNode;
  hideHeader?: boolean;
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
  group = false,
  transcript,
  liveHeads,
  canSend = true,
  onSubmitMessage,
  onReachTop,
  headerRight,
  hideHeader = false,
}: ChatScreenProps) {
  const model = useMemo(() => buildChatRenderModel(transcript, liveHeads), [liveHeads, transcript]);
  const botsById = useMemo(() => new Map(bots.map((bot) => [bot.botId, bot] as const)), [bots]);
  const members = useMemo(() => mentionMembersOf(bots), [bots]);
  const placeholder =
    bots.length === 1 && bots[0] ? botsCopy.messageBot(bots[0].name) : botsCopy.messagePlaceholder;
  return (
    <View style={styles.container} testID={`chat-screen-${chatId}`}>
      {!hideHeader ? <MenuHeader title={title} rightContent={headerRight} /> : null}
      <ComposerDock>
        <ToolCallSheetProvider>
          <ChatList
            scrollKey={`${serverId}:${chatId}`}
            rows={model.rows}
            serverId={serverId}
            bots={botsById}
            members={members}
            onReachTop={onReachTop}
          />
        </ToolCallSheetProvider>
        <ChatComposer
          serverId={serverId}
          chatId={chatId}
          placeholder={placeholder}
          disabled={!canSend}
          onSubmitMessage={onSubmitMessage}
          mentionMembers={group ? members : undefined}
        />
      </ComposerDock>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, backgroundColor: theme.colors.surface0 },
}));
