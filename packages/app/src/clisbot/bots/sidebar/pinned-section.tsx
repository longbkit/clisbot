import { UnavailablePinRow } from "./unavailable-pin-row";
import type { ResourcePin } from "./pins";
import { useLimitedSidebarGroup } from "@/components/sidebar/use-limited-sidebar-group";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useCallback, useMemo, type ReactNode } from "react";
import { PinMark } from "@/components/ui/pin-mark";

import { usePathname, useRouter } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { PinOptionsMenu } from "./pin-options";
import { BotsSectionHeader, useSectionCollapsed, sectionRowIndent } from "./section-header";
import { BotRow } from "./bots-section";
import { ChatRow } from "./chats-section";
import { useSidebarPinMenu } from "./use-section-actions";
import { usePinnedRows, type PinRow } from "./use-pinned-rows";
import type { ChatListAdmission } from "@/clisbot/home/use-chat-list-navigation";

export function FusionPinnedSection({
  onBeforeNavigate,
  renderWorkspacePin,
  float = false,
}: {
  onBeforeNavigate?: ChatListAdmission;
  renderWorkspacePin: (row: Exclude<PinRow, { kind: "bot" | "chat" | "unavailable" }>) => ReactNode;
  /** Navigation V2 Work: only pinned work, floated above the projects with a pin mark. */
  float?: boolean;
}) {
  const pinned = usePinnedRows(onBeforeNavigate);
  const { error, chats, openBot: openPinnedBot, toggle } = pinned;
  const rows = useMemo(
    () => (float ? pinned.rows.filter(isWorkPin) : pinned.rows),
    [float, pinned.rows],
  );
  const menu = useSidebarPinMenu(onBeforeNavigate, chats);
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { visibleItems, expanded, canToggle, toggleExpanded } = useLimitedSidebarGroup(rows);
  const [storedCollapsed, toggleCollapsed] = useSectionCollapsed("pinned");
  const collapsed = !float && storedCollapsed;
  const openChat = useCallback(
    (chat: { serverId: string; chatId: string }) => {
      const row = rows.find(
        (r) =>
          r.kind === "chat" && r.chat.serverId === chat.serverId && r.chat.chatId === chat.chatId,
      );
      if (row) {
        const go = () => router.push(row.route as import("expo-router").Href);
        if (!onBeforeNavigate?.(row.route, go)) go();
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
      {float ? null : (
        <BotsSectionHeader
          label={t("bots.workspace.sidebar.pinned")}
          icon="Pinned"
          testID="sidebar-unified-pinned"
          collapsed={collapsed}
          onToggle={toggleCollapsed}
        />
      )}
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
              {float ? (
                <FloatedPin>
                  {renderPin(row, pathname, openBot, openChat, menu, renderWorkspacePin, toggle)}
                </FloatedPin>
              ) : (
                renderPin(row, pathname, openBot, openChat, menu, renderWorkspacePin, toggle)
              )}
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
function isWorkPin(row: PinRow): boolean {
  if (row.kind === "bot" || row.kind === "chat") return false;
  return row.kind !== "unavailable" || (row.pin.kind !== "bot" && row.pin.kind !== "chat");
}

/** A pinned row in a list without a Pinned section: the row, with a pin mark at its start. */
function FloatedPin({ children }: { children: ReactNode }) {
  return (
    <View style={styles.floated} testID="pinned-float">
      <View style={styles.floatedMark}>
        <PinMark />
      </View>
      <View style={styles.floatedRow}>{children}</View>
    </View>
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
  floated: { flexDirection: "row", alignItems: "center" },
  floatedMark: {
    position: "absolute",
    left: theme.spacing[0],
    top: theme.spacing[0],
    bottom: theme.spacing[0],
    justifyContent: "center",
    zIndex: 1,
  },
  floatedRow: { flex: 1, minWidth: 0 },
  error: { color: theme.colors.foregroundMuted, padding: 8, fontSize: theme.fontSize.sm },
}));
