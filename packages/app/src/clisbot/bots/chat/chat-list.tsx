import { BotWorkspaceContext } from "./bot-workspace-context";
import { memo, useCallback, useMemo } from "react";
import { FlatList, type ListRenderItemInfo } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ChatLiveRow, type RespondToPermission } from "./chat-live-row";
import {
  botIdentity,
  ChatBotRow,
  ChatSystemRow,
  ChatUserRow,
  type ChatBotIdentity,
} from "./chat-rows";
import { chatRowSender, type ChatRenderRow } from "./render-model";

interface ChatListProps {
  rows: readonly ChatRenderRow[];
  serverId: string;
  bots: ReadonlyMap<string, ChatBotIdentity>;
  onRespondPermission?: RespondToPermission;
  /** The top of the transcript came into view: load the older page. */
  onReachTop?: () => void;
}

const MAINTAIN_VISIBLE_POSITION = { minIndexForVisible: 0 } as const;

function keyExtractor(row: ChatRenderRow): string {
  return row.key;
}

/**
 * The transcript plus live heads as one inverted list (plans/app.md R3): newest at the bottom
 * without a bottom-anchor controller, and `maintainVisibleContentPosition` keeps the reader
 * in place when a page is prepended or a live head grows.
 */
export const ChatList = memo(function ChatList({
  rows,
  serverId,
  bots,
  onRespondPermission,
  onReachTop,
}: ChatListProps) {
  const data = useMemo(() => rows.toReversed(), [rows]);
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ChatRenderRow>) => {
      // Inverted: the row after this one in reading order sits at `index - 1`.
      const next = data[index - 1];
      const closesGroup = chatRowSender(next) !== chatRowSender(item);
      return (
        <ChatRowView
          row={item}
          serverId={serverId}
          bots={bots}
          closesGroup={closesGroup}
          onRespondPermission={onRespondPermission}
        />
      );
    },
    [bots, data, onRespondPermission, serverId],
  );
  return (
    <FlatList
      inverted
      data={data}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      onEndReached={onReachTop}
      onEndReachedThreshold={0.5}
      maintainVisibleContentPosition={MAINTAIN_VISIBLE_POSITION}
      contentContainerStyle={styles.content}
      testID="chat-list"
    />
  );
});

function ChatRowView({
  row,
  serverId,
  bots,
  closesGroup,
  onRespondPermission,
}: {
  row: ChatRenderRow;
  serverId: string;
  bots: ReadonlyMap<string, ChatBotIdentity>;
  closesGroup: boolean;
  onRespondPermission?: RespondToPermission;
}) {
  switch (row.kind) {
    case "user":
      return <ChatUserRow row={row} serverId={serverId} closesGroup={closesGroup} />;
    case "bot":
      return (
        <BotWorkspaceContext serverId={serverId} bot={botIdentity(bots, row.botId)}>
          <ChatBotRow row={row} bot={botIdentity(bots, row.botId)} serverId={serverId} />
        </BotWorkspaceContext>
      );
    case "system":
      return <ChatSystemRow row={row} />;
    case "live":
      return (
        <BotWorkspaceContext serverId={serverId} bot={botIdentity(bots, row.botId)}>
          <ChatLiveRow
            row={row}
            bot={botIdentity(bots, row.botId)}
            serverId={serverId}
            onRespondPermission={onRespondPermission}
          />
        </BotWorkspaceContext>
      );
  }
}

const styles = StyleSheet.create((theme) => ({
  content: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
}));
