import { memo, useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { HOME_V2_ENABLED } from "@/clisbot/home/feature";
import { QuickChatMark } from "@/clisbot/home/start-destinations";
import { BotsSidebarRow, sidebarMarkSize } from "@/clisbot/bots/sidebar/row";
import { BotsSectionHeader, useSectionCollapsed } from "@/clisbot/bots/sidebar/section-header";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import { useHosts } from "@/runtime/host-runtime";
import {
  navigateToWorkspace,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { workspaceEqualityFns } from "@/stores/session-store-hooks/selectors";
import { isQuickChatPath } from "./quick-chat-projects";

const RECENT_QUICK_CHATS = 5;

interface QuickChatRow {
  key: string;
  serverId: string;
  workspaceId: string;
  title: string;
  startedAt: string;
  hostLabel: string | null;
}

/**
 * Quick chats are kept out of Projects (their folder is an implementation detail) but stay one tap
 * away here, newest first across every Host.
 */
export function QuickChatsSection({ onBeforeNavigate }: { onBeforeNavigate?: () => void }) {
  const chats = useQuickChatRows();
  const selection = useActiveWorkspaceSelection();
  const [collapsed, toggleCollapsed] = useSectionCollapsed("quickChats");
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);
  const open = useCallback(
    (chat: QuickChatRow) => {
      onBeforeNavigate?.();
      navigateToWorkspace({ serverId: chat.serverId, workspaceId: chat.workspaceId });
    },
    [onBeforeNavigate],
  );
  if (!HOME_V2_ENABLED || chats.length === 0) return null;
  const visible = expanded ? chats : chats.slice(0, RECENT_QUICK_CHATS);
  return (
    <View testID="sidebar-quick-chats-section">
      <BotsSectionHeader
        label="Quick chats"
        testID="sidebar-quick-chats-header"
        collapsed={collapsed}
        onToggle={toggleCollapsed}
      />
      {collapsed ? null : (
        <>
          {visible.map((chat) => (
            <QuickChatSidebarRow
              key={chat.key}
              chat={chat}
              selected={
                selection?.serverId === chat.serverId && selection.workspaceId === chat.workspaceId
              }
              onPress={open}
            />
          ))}
          {chats.length > RECENT_QUICK_CHATS ? (
            <SidebarGroupToggleRow
              expanded={expanded}
              onPress={toggleExpanded}
              testID="sidebar-quick-chats-toggle"
            />
          ) : null}
        </>
      )}
    </View>
  );
}

const QuickChatSidebarRow = memo(function QuickChatSidebarRow({
  chat,
  selected,
  onPress,
}: {
  chat: QuickChatRow;
  selected: boolean;
  onPress: (chat: QuickChatRow) => void;
}) {
  const startedAt = useMemo(() => new Date(chat.startedAt), [chat.startedAt]);
  const timeAgo = useCompactTimeAgo(startedAt);
  const press = useCallback(() => onPress(chat), [chat, onPress]);
  const markSize = sidebarMarkSize(Boolean(chat.hostLabel));
  const leading = useMemo(() => <QuickChatMark size={markSize} />, [markSize]);
  return (
    <BotsSidebarRow
      leading={leading}
      title={chat.title}
      subtitle={chat.hostLabel}
      trailing={timeAgo}
      selected={selected}
      testID={`sidebar-quick-chat-${chat.serverId}-${chat.workspaceId}`}
      onPress={press}
    />
  );
});

/** Every Host's Quick chat workspaces, newest first; the Host is named when there are several. */
function useQuickChatRows(): QuickChatRow[] {
  const hosts = useHosts();
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      const rows: QuickChatRow[] = [];
      for (const host of hosts) {
        const session = state.sessions[host.serverId];
        const root = session?.serverInfo?.quickChatRoot;
        if (!session || !root) continue;
        for (const workspace of session.workspaces.values()) {
          if (workspace.archivingAt || !isQuickChatPath(workspace.workspaceDirectory, root))
            continue;
          rows.push({
            key: `${host.serverId}:${workspace.id}`,
            serverId: host.serverId,
            workspaceId: workspace.id,
            title: workspace.title?.trim() || workspace.name,
            startedAt: workspace.createdAt ?? new Date(0).toISOString(),
            hostLabel: hosts.length > 1 ? host.label : null,
          });
        }
      }
      return rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },
    workspaceEqualityFns.deep,
  );
}
