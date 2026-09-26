import { memo, useCallback, useMemo, useState } from "react";
import { usePathname, useRouter } from "expo-router";
import { View } from "react-native";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import { botsCopy } from "../copy";
import { buildHostChatRoute, parseChatRouteFromPathname } from "../routes";
import { BotsSidebarRow } from "./row";
import { BotsSectionHeader } from "./section-header";

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
  /** A participating bot is mid-turn. */
  active?: boolean;
}

interface ChatsSectionProps {
  /** Newest first; the caller sorts (`sortChatsNewestFirst`). */
  chats: readonly ChatsSidebarChat[];
  /** Runs before the route push, as `AutomationSidebarItem` does; the compact sidebar closes here. */
  onBeforeNavigate?: () => void;
  onOpenChatMenu?: (chat: ChatsSidebarChat) => void;
}

/** The Chats section: recent chats, the current one filled, capped with a toggle row. */
export const ChatsSection = memo(function ChatsSection({
  chats,
  onBeforeNavigate,
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
  if (chats.length === 0) return null;
  return (
    <View testID="sidebar-chats-section">
      <BotsSectionHeader label={botsCopy.chats} testID="sidebar-chats-header" />
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
  onOpenMenu?: (chat: ChatsSidebarChat) => void;
}) {
  const updatedAt = useMemo(() => new Date(chat.updatedAt), [chat.updatedAt]);
  const timeAgo = useCompactTimeAgo(updatedAt);
  const handlePress = useCallback(() => onPress(chat), [chat, onPress]);
  const handleOpenMenu = useCallback(() => onOpenMenu?.(chat), [chat, onOpenMenu]);
  return (
    <BotsSidebarRow
      leading={chatLeading}
      title={chat.title}
      subtitle={chat.hostLabel}
      trailing={timeAgo}
      active={chat.active}
      selected={selected}
      testID={`sidebar-chat-${chat.chatId}`}
      onPress={handlePress}
      onOpenMenu={onOpenMenu ? handleOpenMenu : undefined}
      menuLabel={botsCopy.chatOptions}
    />
  );
});

// A neutral leading mark keeps chat titles on the same rail as bot faces. Plain object, not a
// Unistyles style, so building the element at module scope materialises nothing theme-bound.
const leadingDotStyle = { width: 6, height: 6, borderRadius: 3, opacity: 0 } as const;
const chatLeading = <View style={leadingDotStyle} />;
