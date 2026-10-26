import { selectChatStatusBucket } from "./row-status";
import type { Rect } from "@/components/ui/anchor";
import { ChatAvatar } from "../chat/chat-avatar";
import type { GroupMarkMember } from "../chat/group-mark";
import { useSessionStore } from "@/stores/session-store";
import { memo, useCallback, useMemo, useState } from "react";
import { usePathname, useRouter } from "expo-router";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { FlatList } from "@/components/ui/scroll-view";
import { SectionFooter } from "./section-footer";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import { buildHostChatRoute, parseChatRouteFromPathname } from "../routes";
import { BotsSidebarRow, sidebarMarkSize } from "./row";
import { BotsSectionHeader, useSectionCollapsed } from "./section-header";
import { useChatRowDetail } from "./display/use-row-detail";
import { SectionDisplayMenu } from "./display/section-display-menu";
import type { ChatListAdmission } from "@/clisbot/home/use-chat-list-navigation";

/** Recent chats before "Show more" (plans/app.md §1). */
export const RECENT_CHATS_LIMIT = 5;

export interface ChatsSidebarChat {
  /** `${serverId}:${chatId}`, unique across hosts. */
  key: string;
  serverId: string;
  chatId: string;
  /** The chat's title, or the participant names joined for a group chat. */
  title: string;
  updatedAt: string;
  hostLabel?: string | null;
  hostName?: string;
  /** Participants' display names, in Members order. */
  memberNames?: readonly string[];
  /** Participants for the Group chat mark, in Members order. */
  members?: readonly GroupMarkMember[];
  /** A participating bot is mid-turn. */
  active?: boolean;
  agentIds?: readonly string[];
}

interface ChatsSectionProps {
  /** Newest first; the caller sorts (`sortChatsNewestFirst`). */
  chats: readonly ChatsSidebarChat[];
  directoryChats?: readonly ChatsSidebarChat[];
  /** Runs before the route push, as `AutomationSidebarItem` does; the compact sidebar closes here. */
  onBeforeNavigate?: ChatListAdmission;
  onCreateChat: () => void;
  canCreateChat?: boolean;
  onOpenChatMenu?: (chat: ChatsSidebarChat, anchor: Rect) => void;
}

/** The Chats section: recent chats, the current one filled, capped with a toggle row. */
export const ChatsSection = memo(function ChatsSection({
  chats,
  directoryChats = chats,
  onBeforeNavigate,
  onCreateChat,
  canCreateChat = true,
  onOpenChatMenu,
}: ChatsSectionProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const pathname = usePathname();
  const current = useMemo(() => parseChatRouteFromPathname(pathname), [pathname]);
  const [expanded, setExpanded] = useState(false);
  const [directory, setDirectory] = useState(false);
  const openDirectory = useCallback(() => setDirectory(true), []);
  const closeDirectory = useCallback(() => setDirectory(false), []);
  const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);
  const visible = expanded ? chats : chats.slice(0, RECENT_CHATS_LIMIT);
  const openChat = useCallback(
    (chat: ChatsSidebarChat) => {
      setDirectory(false);
      const destination = buildHostChatRoute(chat.serverId, chat.chatId);
      const go = () => router.push(destination);
      if (!onBeforeNavigate?.(destination, go)) go();
    },
    [onBeforeNavigate, router],
  );
  const [collapsed, toggleCollapsed] = useSectionCollapsed("chats");
  // Before the first bot exists there is nothing to group; the Bots section promotes creation.
  if (!canCreateChat && chats.length === 0) return null;
  return (
    <View testID="sidebar-chats-section">
      <BotsSectionHeader
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        label={t("bots.workspace.shared.groupChats")}
        icon="Group chats"
        testID="sidebar-chats-header"
        createLabel={t("bots.workspace.shared.createGroupChat")}
        onCreate={onCreateChat}
        disabled={!canCreateChat}
        actions={chatsDisplayMenu}
      />
      {!collapsed ? (
        <>
          {!canCreateChat ? (
            <Text style={hintStyles.hint}>{t("bots.workspace.shared.createBotFirst")}</Text>
          ) : null}
          {visible.map((chat) => (
            <ChatRow
              key={chat.key}
              chat={chat}
              selected={current?.serverId === chat.serverId && current.chatId === chat.chatId}
              onPress={openChat}
              onOpenMenu={onOpenChatMenu}
            />
          ))}
          {chats.length > RECENT_CHATS_LIMIT ? (
            <SectionFooter
              expanded={expanded}
              onToggle={toggleExpanded}
              count={directoryChats.length}
              onViewAll={openDirectory}
              testID="sidebar-chats-footer"
            />
          ) : null}
        </>
      ) : null}
      <ChatDirectory
        visible={directory}
        chats={directoryChats}
        current={current}
        onClose={closeDirectory}
        onPress={openChat}
      />
    </View>
  );
});

function ChatDirectory({
  visible,
  chats,
  current,
  onClose,
  onPress,
}: {
  visible: boolean;
  chats: readonly ChatsSidebarChat[];
  current: { serverId: string; chatId: string } | null;
  onClose: () => void;
  onPress: (chat: ChatsSidebarChat) => void;
}) {
  const { t } = useTranslation();
  const header = useMemo(() => ({ title: t("bots.workspace.shared.groupChats") }), [t]);
  const renderItem = useCallback(
    ({ item }: { item: ChatsSidebarChat }) => (
      <ChatRow
        chat={item}
        selected={current?.serverId === item.serverId && current.chatId === item.chatId}
        onPress={onPress}
      />
    ),
    [current, onPress],
  );
  return (
    <AdaptiveModalSheet visible={visible} onClose={onClose} header={header} scrollable={false}>
      <View style={hintStyles.directory}>
        <FlatList
          data={chats}
          keyExtractor={chatKey}
          renderItem={renderItem}
          style={hintStyles.list}
        />
      </View>
    </AdaptiveModalSheet>
  );
}
const chatKey = (chat: ChatsSidebarChat) => chat.key;

export const ChatRow = memo(function ChatRow({
  chat,
  selected,
  onPress,
  onOpenMenu,
  pinned = false,
}: {
  pinned?: boolean;
  chat: ChatsSidebarChat;
  selected: boolean;
  onPress: (chat: ChatsSidebarChat) => void;
  onOpenMenu?: (chat: ChatsSidebarChat, anchor: Rect) => void;
}) {
  const statusBucket = useSessionStore((state) =>
    selectChatStatusBucket(state.sessions[chat.serverId], chat.agentIds ?? []),
  );
  const updatedAt = useMemo(() => new Date(chat.updatedAt), [chat.updatedAt]);
  const timeAgo = useCompactTimeAgo(updatedAt);
  const detailInput = useMemo(
    () => ({ hostName: chat.hostName, memberNames: chat.memberNames ?? [] }),
    [chat.hostName, chat.memberNames],
  );
  const detail = useChatRowDetail(detailInput);
  const { t } = useTranslation();
  const markSize = sidebarMarkSize(Boolean(detail));
  const chatLeading = useMemo(
    () => <ChatAvatar chatId={chat.chatId} group members={chat.members} size={markSize} />,
    [chat.chatId, chat.members, markSize],
  );
  const handlePress = useCallback(() => onPress(chat), [chat, onPress]);
  const handleOpenMenu = useCallback(
    (anchor: Rect) => onOpenMenu?.(chat, anchor),
    [chat, onOpenMenu],
  );
  return (
    <BotsSidebarRow
      leading={chatLeading}
      title={chat.title}
      subtitle={detail}
      trailing={timeAgo}
      statusBucket={chat.active ? "running" : statusBucket}
      selected={selected}
      testID={`sidebar-chat-${chat.chatId}`}
      onPress={handlePress}
      onOpenMenu={onOpenMenu ? handleOpenMenu : undefined}
      menuLabel={t("bots.workspace.shared.chatOptions")}
      pinned={pinned}
    />
  );
});

const chatsDisplayMenu = <SectionDisplayMenu section="chats" />;

const hintStyles = StyleSheet.create((theme) => ({
  directory: { minHeight: 280, maxHeight: 520, flexShrink: 1 },
  list: { flexGrow: 0, flexShrink: 1 },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
}));
