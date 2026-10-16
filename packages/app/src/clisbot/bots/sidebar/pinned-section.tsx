import { UnavailablePinRow } from "./unavailable-pin-row";
import type { ResourcePin } from "./pins";
import { useLimitedSidebarGroup } from "@/components/sidebar/use-limited-sidebar-group";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useCallback, type ReactNode } from "react";
import { usePathname, useRouter } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { PinOptionsMenu } from "./pin-options";
import { BotsSectionHeader, useSectionCollapsed, sectionRowIndent } from "./section-header";
import { BotRow } from "./bots-section";
import { ChatRow } from "./chats-section";
import { useSidebarPinMenu } from "./use-section-actions";
import { usePinnedRows, type PinRow } from "./use-pinned-rows";

export function FusionPinnedSection({
  onBeforeNavigate,
  renderWorkspacePin,
}: {
  onBeforeNavigate?: (destination?: string) => void;
  renderWorkspacePin: (row: Exclude<PinRow, { kind: "bot" | "chat" | "unavailable" }>) => ReactNode;
}) {
  const { rows, error, chats, openBot: openPinnedBot, toggle } = usePinnedRows(onBeforeNavigate);
  const menu = useSidebarPinMenu(onBeforeNavigate, chats);
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { visibleItems, expanded, canToggle, toggleExpanded } = useLimitedSidebarGroup(rows);
  const [collapsed, toggleCollapsed] = useSectionCollapsed("pinned");
  const openChat = useCallback(
    (chat: { serverId: string; chatId: string }) => {
      const row = rows.find(
        (r) =>
          r.kind === "chat" && r.chat.serverId === chat.serverId && r.chat.chatId === chat.chatId,
      );
      if (row) {
        onBeforeNavigate?.(row.route);
        router.push(row.route as import("expo-router").Href);
      }
    },
    [onBeforeNavigate, router, rows],
  );
  const openBot = useCallback(
    (bot: { serverId: string; botId: string }) => {
      void openPinnedBot(bot.serverId, bot.botId);
    },
    [openPinnedBot],
  );
  if (rows.length === 0 && !error) return null;
  return (
    <>
      <BotsSectionHeader
        label={t("bots.workspace.sidebar.pinned")}
        icon="Pinned"
        testID="sidebar-unified-pinned"
        collapsed={collapsed}
        onToggle={toggleCollapsed}
      />
      {error || menu.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error || menu.error}
        </Text>
      ) : null}
      {!collapsed
        ? visibleItems.map((row) => (
            <View
              key={row.key}
              testID={`sidebar-pin-${row.key}`}
              style={
                row.kind === "bot" || row.kind === "chat" || row.kind === "unavailable"
                  ? undefined
                  : styles.workspacePin
              }
            >
              {renderPin(row, pathname, openBot, openChat, menu, renderWorkspacePin, toggle)}
            </View>
          ))
        : null}
      {!collapsed && canToggle ? (
        <SidebarGroupToggleRow
          expanded={expanded}
          onPress={toggleExpanded}
          testID="sidebar-unified-pinned-show-more"
        />
      ) : null}
      <PinOptionsMenu
        anchor={menu.menu?.anchor}
        visible={menu.menu !== null}
        title={t("bots.workspace.sidebar.pinnedItemOptions")}
        actions={menu.actions}
        onSelect={menu.selectAction}
        onClose={menu.closeMenu}
      />
    </>
  );
}
function renderPin(
  row: PinRow,
  pathname: string,
  openBot: (bot: { serverId: string; botId: string }) => void,
  openChat: (chat: { serverId: string; chatId: string }) => void,
  menu: ReturnType<typeof useSidebarPinMenu>,
  renderWorkspacePin: (row: Exclude<PinRow, { kind: "bot" | "chat" | "unavailable" }>) => ReactNode,
  onUnpin: (pin: ResourcePin) => void,
) {
  if (row.kind === "unavailable") return <UnavailablePinRow pin={row.pin} onUnpin={onUnpin} />;
  if (row.kind === "bot")
    return (
      <BotRow
        bot={row.bot}
        selected={row.route === pathname}
        onPress={openBot}
        onOpenMenu={menu.onBotMenu}
      />
    );
  if (row.kind === "chat")
    return (
      <ChatRow
        chat={row.chat}
        selected={row.route === pathname}
        onPress={openChat}
        onOpenMenu={menu.onChatMenu}
      />
    );
  return renderWorkspacePin(row);
}

const styles = StyleSheet.create((theme) => ({
  workspacePin: { paddingLeft: sectionRowIndent(theme) },
  error: { color: theme.colors.foregroundMuted, padding: 8, fontSize: theme.fontSize.sm },
}));
