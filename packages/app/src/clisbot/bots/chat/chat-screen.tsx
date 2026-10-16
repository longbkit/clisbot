import type { MessagePayload } from "@/composer/types";
import { profileNativeRegion } from "@/utils/render-profiler";
import { ToolCallSheetProvider } from "@/components/tool-call-sheet";
import { ComposerDock } from "@/composer/dock";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import type { ChatMessage } from "../data/contracts";
import { ChatComposer } from "./chat-composer";
import { mentionMembersOf } from "./member-mentions";
import { ChatList } from "./chat-list";
import type { ChatBotIdentity } from "./chat-rows";
import { buildChatRenderModel, type ChatLiveHead } from "./render-model";
import type { ChatToolDisplay } from "@clisbot/protocol/chats/tool-display";

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
  /** How a Bot's running turn shows its tool calls (the Bot's or the group's setting). */
  toolDisplay?: ChatToolDisplay;
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
  toolDisplay,
}: ChatScreenProps) {
  const { t } = useTranslation();
  const model = useMemo(
    () => buildChatRenderModel(transcript, liveHeads, { group }),
    [group, liveHeads, transcript],
  );
  const botsById = useMemo(() => new Map(bots.map((bot) => [bot.botId, bot] as const)), [bots]);
  const members = useMemo(() => mentionMembersOf(bots), [bots]);
  const placeholder =
    bots.length === 1 && bots[0]
      ? t("bots.chat.screen.messageBot", { name: bots[0].name })
      : t("bots.chat.screen.messagePlaceholder");
  return (
    <View style={styles.container} testID={`chat-screen-${chatId}`}>
      {!hideHeader ? <MenuHeader title={title} rightContent={headerRight} /> : null}
      <ComposerDock>
        <ToolCallSheetProvider>
          {profileNativeRegion(
            "BotChatHistory",
            <ChatList
              scrollKey={`${serverId}:${chatId}`}
              rows={model.rows}
              serverId={serverId}
              bots={botsById}
              members={members}
              onReachTop={onReachTop}
              toolDisplay={toolDisplay}
            />,
          )}
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
