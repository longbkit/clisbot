import type { Rect } from "@/components/ui/menu/menu-anchor";
import { useSessionStore, selectAgentTurnPresentation } from "@/stores/session-store";
import { memo, useCallback, useMemo, useState } from "react";
import { usePathname, useRouter } from "expo-router";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import { Hash } from "lucide-react-native";
import { botsCopy } from "../copy";
import { buildHostChatRoute, parseChatRouteFromPathname } from "../routes";
import { BotsSidebarRow } from "./row";
import { BotsSectionHeader, useSectionCollapsed } from "./section-header";
import { useChatRowDetail } from "./display/use-row-detail";
import { SectionDisplayMenu } from "./display/section-display-menu";

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
  /** A participating bot is mid-turn. */
  active?: boolean;
  agentIds?: readonly string[];
}

interface ChatsSectionProps {
  /** Newest first; the caller sorts (`sortChatsNewestFirst`). */
  chats: readonly ChatsSidebarChat[];
  /** Runs before the route push, as `AutomationSidebarItem` does; the compact sidebar closes here. */
  onBeforeNavigate?: () => void;
  onCreateChat: () => void;
  canCreateChat?: boolean;
  onOpenChatMenu?: (chat: ChatsSidebarChat, anchor: Rect) => void;
}

/** The Chats section: recent chats, the current one filled, capped with a toggle row. */
export const ChatsSection = memo(function ChatsSection({
  chats,
  onBeforeNavigate,
  onCreateChat,
  canCreateChat = true,
  onOpenChatMenu,
}: ChatsSectionProps) {
  const router = useRouter();
  const pathname = usePathname();
  const current = useMemo(() => parseChatRouteFromPathname(pathname), [pathname]);
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);
  const visible = expanded ? chats : chats.slice(0, RECENT_CHATS_LIMIT);
  const openChat = useCallback(
    (chat: ChatsSidebarChat) => {
      onBeforeNavigate?.();
      router.push(buildHostChatRoute(chat.serverId, chat.chatId));
    },
    [onBeforeNavigate, router],
  );
  const [collapsed, toggleCollapsed] = useSectionCollapsed("chats");
  return (
    <View testID="sidebar-chats-section">
      <BotsSectionHeader
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        label={botsCopy.groupChats}
        testID="sidebar-chats-header"
        createLabel={botsCopy.createGroupChat}
        onCreate={onCreateChat}
        disabled={!canCreateChat}
        actions={chatsDisplayMenu}
      />
      {!collapsed ? (
        <>
          {!canCreateChat ? <Text style={hintStyles.hint}>{botsCopy.createBotFirst}</Text> : null}
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
            <SidebarGroupToggleRow
              expanded={expanded}
              onPress={toggleExpanded}
              testID="sidebar-chats-toggle"
            />
          ) : null}
        </>
      ) : null}
    </View>
  );
});

const ChatRow = memo(function ChatRow({
  chat,
  selected,
  onPress,
  onOpenMenu,
}: {
  chat: ChatsSidebarChat;
  selected: boolean;
  onPress: (chat: ChatsSidebarChat) => void;
  onOpenMenu?: (chat: ChatsSidebarChat, anchor: Rect) => void;
}) {
  const active = useSessionStore(
    (state) =>
      chat.agentIds?.some(
        (id) => selectAgentTurnPresentation(state.sessions[chat.serverId], id).isActive,
      ) ?? false,
  );
  const updatedAt = useMemo(() => new Date(chat.updatedAt), [chat.updatedAt]);
  const timeAgo = useCompactTimeAgo(updatedAt);
  const detailInput = useMemo(
    () => ({ hostName: chat.hostName, memberNames: chat.memberNames ?? [] }),
    [chat.hostName, chat.memberNames],
  );
  const detail = useChatRowDetail(detailInput);
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
      active={chat.active ?? active}
      selected={selected}
      testID={`sidebar-chat-${chat.chatId}`}
      onPress={handlePress}
      onOpenMenu={onOpenMenu ? handleOpenMenu : undefined}
      menuLabel={botsCopy.chatOptions}
    />
  );
});

const chatsDisplayMenu = <SectionDisplayMenu section="chats" />;

// A neutral leading mark keeps chat titles on the same rail as bot faces. Plain object, not a
// Unistyles style, so building the element at module scope materialises nothing theme-bound.
const ThemedHash = withUnistyles(Hash);
const chatLeading = (
  <ThemedHash size={16} uniProps={(theme) => ({ color: theme.colors.foregroundMuted })} />
);

const hintStyles = StyleSheet.create((theme) => ({
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
}));
