import { useStableEvent } from "@/hooks/use-stable-event";
import { HeartbeatRunMarker } from "@/clisbot/heartbeats/heartbeat-run-marker";
import { useChatTurnHeartbeats } from "@/clisbot/heartbeats/use-chat-turn-heartbeats";
import { useChatKeyboardDismiss } from "./use-chat-keyboard-dismiss";
import { useChatScrollPosition } from "./use-chat-scroll-position";
import { usePinchZoomPassthrough } from "./use-pinch-zoom-passthrough";
import { BotWorkspaceContext } from "./bot-workspace-context";
import { memo, useCallback, useMemo } from "react";
import { FlatList, View, type ListRenderItemInfo } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ChatLiveRow } from "./chat-live-row";
import {
  botIdentity,
  ChatBotRow,
  ChatSystemRow,
  ChatUserRow,
  type ChatBotIdentity,
} from "./chat-rows";
import type { MentionMember } from "./member-mentions";
import { chatRowSender, type ChatRenderRow } from "./render-model";

interface ChatListProps {
  rows: readonly ChatRenderRow[];
  serverId: string;
  scrollKey?: string;
  bots: ReadonlyMap<string, ChatBotIdentity>;
  /** The participants a transcript line's `@slug` names. */
  members?: readonly MentionMember[];
  /** The top of the transcript came into view: load the older page. */
  onReachTop?: () => void;
}

const NO_MEMBERS: readonly MentionMember[] = [];
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
  members = NO_MEMBERS,
  scrollKey = serverId,
  onReachTop,
}: ChatListProps) {
  const scrollPosition = useChatScrollPosition<ChatRenderRow>(scrollKey);
  const keyboardDismiss = useChatKeyboardDismiss();
  usePinchZoomPassthrough(scrollPosition.ref);
  const onScroll = useStableEvent((event: Parameters<typeof scrollPosition.onScroll>[0]) => {
    scrollPosition.onScroll(event);
    keyboardDismiss.onScroll(event);
  });
  const onScrollBeginDrag = useStableEvent(
    (event: Parameters<typeof scrollPosition.onScroll>[0]) => {
      scrollPosition.onScrollBeginDrag();
      keyboardDismiss.onScrollBeginDrag(event);
    },
  );
  const data = useMemo(() => rows.toReversed(), [rows]);
  // Clisbot: a heartbeat a Bot made in a turn shows as its card above that turn's reply.
  const heartbeatsByLine = useChatTurnHeartbeats(serverId, rows);
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ChatRenderRow>) => {
      // Inverted: the row after this one in reading order sits at `index - 1`.
      const next = data[index - 1];
      const closesGroup = chatRowSender(next) !== chatRowSender(item);
      return (
        <View style={styles.row}>
          <ChatRowView
            row={item}
            serverId={serverId}
            bots={bots}
            members={members}
            closesGroup={closesGroup}
            heartbeatIds={item.kind === "bot" ? heartbeatsByLine.get(item.line.id) : undefined}
          />
        </View>
      );
    },
    [bots, data, heartbeatsByLine, members, serverId],
  );
  return (
    <FlatList
      {...scrollPosition}
      onScroll={onScroll}
      onScrollBeginDrag={onScrollBeginDrag}
      onScrollEndDrag={keyboardDismiss.onScrollEndDrag}
      scrollEventThrottle={16}
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
  members,
  closesGroup,
  heartbeatIds,
}: {
  row: ChatRenderRow;
  serverId: string;
  bots: ReadonlyMap<string, ChatBotIdentity>;
  members: readonly MentionMember[];
  closesGroup: boolean;
  heartbeatIds?: readonly string[];
}) {
  switch (row.kind) {
    case "user":
      return (
        <ChatUserRow row={row} serverId={serverId} closesGroup={closesGroup} members={members} />
      );
    case "bot":
      return (
        <BotWorkspaceContext serverId={serverId} bot={botIdentity(bots, row.botId)}>
          <ChatBotRow
            row={row}
            bot={botIdentity(bots, row.botId)}
            serverId={serverId}
            members={members}
            heartbeatIds={heartbeatIds}
          />
        </BotWorkspaceContext>
      );
    case "system":
      return <ChatSystemRow row={row} />;
    case "heartbeat":
      return <HeartbeatRunMarker message={row.label} />;
    case "live":
      return (
        <BotWorkspaceContext serverId={serverId} bot={botIdentity(bots, row.botId)}>
          <ChatLiveRow row={row} bot={botIdentity(bots, row.botId)} serverId={serverId} />
        </BotWorkspaceContext>
      );
  }
}

const styles = StyleSheet.create((theme) => ({
  // Match the agent stream's item wrapper, including its inner reading gutter.
  row: {
    width: "100%",
    maxWidth: theme.contentMaxWidth,
    alignSelf: "center",
    paddingHorizontal: theme.spacing[2],
  },
  content: {
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[4] },
    paddingVertical: theme.spacing[3],
  },
}));
