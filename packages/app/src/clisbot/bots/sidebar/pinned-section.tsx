import { participationKeyOf } from "@/clisbot/navigation/ownership-key";
import { UnavailablePinRow } from "./unavailable-pin-row";
import type { ResourcePin } from "./pins";
import { useLimitedSidebarGroup } from "@/components/sidebar/use-limited-sidebar-group";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useCallback, useMemo, type ReactNode } from "react";
import { PinnedRowProvider } from "@/components/ui/pin-mark";
import { FLAT_ROW_FILL_INSET } from "@/components/sidebar/row-geometry";

import { usePathname, useRouter } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { PinOptionsMenu } from "./pin-options";
import { BotsSectionHeader, useSectionCollapsed, sectionRowIndent } from "./section-header";
import { BotRow } from "./bots-section";
import { ChatRow } from "./chats-section";
import { useSidebarPinMenu } from "./use-section-actions";
import { usePinnedRows, type PinRow } from "./use-pinned-rows";
import { useOptionalSidebarModel } from "@/components/sidebar/sidebar-model";
import type { WorkFilter } from "@/clisbot/navigation/work-items";
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
  const model = useOptionalSidebarModel();
  const workList = model?.workList ?? null;
  const visibleProjects = model?.projects;
  const rows = useMemo(() => {
    if (!float) return pinned.rows;
    // The scope comes first: a pin floats a row the Workspace list already admits, never another
    // member's row into For me.
    const admitted = (row: PinRow) =>
      !workList || admitsPin(row, workList.filter, visibleProjects ?? []);
    return pinned.rows.filter((row) => isWorkPin(row) && admitted(row));
  }, [float, pinned.rows, workList, visibleProjects]);
  const menu = useSidebarPinMenu(onBeforeNavigate, chats);
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const limited = useLimitedSidebarGroup(rows);
  // Floated pins are part of one list; they are never folded behind Show more.
  const visibleItems = float ? rows : limited.visibleItems;
  const canToggle = !float && limited.canToggle;
  const { expanded, toggleExpanded } = limited;
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
            <View key={row.key} testID={`sidebar-pin-${row.key}`} style={pinStyle(row, float)}>
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
function admitsPin(
  row: PinRow,
  filter: WorkFilter,
  projects: readonly { viewKey: string }[],
): boolean {
  if (row.kind === "workspace") return filter.workspace(row.workspace);
  if (row.kind === "session")
    return filter.session(
      {
        id: row.session.agent.id,
        labels: row.session.agent.labels,
        createdBy: row.session.agent.createdBy,
        participationKey: participationKeyOf(row.session.agent),
        statusBucket: row.session.statusBucket,
      },
      row.workspace,
    );
  if (row.kind === "project") return projects.some((p) => p.viewKey === row.project.viewKey);
  return true;
}

function isWorkPin(row: PinRow): boolean {
  if (row.kind === "bot" || row.kind === "chat") return false;
  return row.kind !== "unavailable" || (row.pin.kind !== "bot" && row.pin.kind !== "chat");
}

/**
 * A pinned row in a list without a Pinned section. The row itself draws the pin mark at the end
 * of its title line (`usePinnedRow`), so every list puts it in the same place.
 */
function FloatedPin({ children }: { children: ReactNode }) {
  return (
    <View testID="pinned-float">
      <PinnedRowProvider value>{children}</PinnedRowProvider>
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

/** A workspace pin's wrapper: a section's indent, or none where it floats over a flat list. */
function pinStyle(row: PinRow, float: boolean) {
  if (row.kind === "bot" || row.kind === "chat" || row.kind === "unavailable") return undefined;
  return float ? styles.workspacePinFloat : styles.workspacePin;
}

const styles = StyleSheet.create((theme) => ({
  workspacePin: { paddingLeft: sectionRowIndent(theme) },
  // Floated above Navigation V2's flat list: no section indent, the fill at `FLAT_ROW_FILL_INSET`.
  workspacePinFloat: { marginLeft: FLAT_ROW_FILL_INSET - theme.spacing[2] },
  error: { color: theme.colors.foregroundMuted, padding: 8, fontSize: theme.fontSize.sm },
}));
