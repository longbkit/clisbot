import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { FlatList } from "@/components/ui/scroll-view";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Bot, Hash, SquarePen } from "lucide-react-native";
import { usePathname } from "expo-router";
import { BotRow, type BotsSidebarBot } from "@/clisbot/bots/sidebar/bots-section";
import { ChatRow, type ChatsSidebarChat } from "@/clisbot/bots/sidebar/chats-section";
import { SectionDisplayMenu } from "@/clisbot/bots/sidebar/display/section-display-menu";
import { PinOptionsMenu } from "@/clisbot/bots/sidebar/pin-options";
import { useSidebarPinMenu } from "@/clisbot/bots/sidebar/use-section-actions";
import { useBotSidebarActions } from "@/clisbot/bots/sidebar/use-sidebar-actions";
import { useCreationRequest } from "@/clisbot/bots/sidebar/creation-request";
import { useBotCreationHosts } from "@/clisbot/bots/feature";
import { parseChatRouteFromPathname } from "@/clisbot/bots/routes";
import { selectedDirectBotKey } from "@/clisbot/bots/sidebar/sidebar-model";
import type { ChatListAdmission } from "@/clisbot/home/use-chat-list-navigation";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { FilterChips, type FilterChip } from "@/components/ui/filter-chips";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { SearchField } from "@/components/ui/search-field";
import {
  CHATS_CHIPS,
  chatScopeCounts,
  matchesChatsChip,
  orderChatList,
  type ChatsChip,
} from "./chat-list";
import { useHeldOrder } from "./held-order";
import { inScope } from "./ownership";
import { ScopeTabs } from "./scope-tabs";
import { HeaderMenuIcon, HeaderSearchButton, SectionHeader } from "./section-header";
import { useNavigationStore } from "./store";
import { useChatEntries, type ChatsEntry } from "./use-chat-entries";

const CHIP_LABELS: Record<ChatsChip, string> = {
  all: "navigation.chips.all",
  unread: "navigation.chips.unread",
  bot: "navigation.chips.botDm",
  groups: "navigation.chips.groups",
  personal: "navigation.chips.personal",
  company: "navigation.chips.company",
};

/** Chats (brief C3): one Telegram-style list of Bot DMs and group chats, pins on top. */
export function ChatsPane({ onBeforeNavigate }: { onBeforeNavigate?: ChatListAdmission }) {
  const { t } = useTranslation();
  const { entries, catalog } = useChatEntries();
  const scope = useNavigationStore((state) => state.scopes.chats);
  const chip = useNavigationStore((state) => state.chatsChip);
  const setChip = useNavigationStore((state) => state.setChatsChip);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const toggleSearch = useCallback(() => {
    setSearchOpen((open) => !open);
    setSearch("");
  }, []);
  const fresh = useMemo(
    () => orderChatList({ entries, scope, chip, search }),
    [entries, scope, chip, search],
  );
  const freshKeys = useMemo(() => fresh.map((entry) => entry.key), [fresh]);
  const { held, handlers } = useHeldOrder(freshKeys);
  const rows = useMemo(
    () => (held ? orderChatList({ entries, scope, chip, search, held }) : fresh),
    [held, fresh, entries, scope, chip, search],
  );
  const chips = useMemo<FilterChip<ChatsChip>[]>(() => {
    const scoped = entries.filter((entry) => inScope(scope, entry.ownership));
    return CHATS_CHIPS.map((value) => ({
      value,
      label: t(CHIP_LABELS[value]),
      count:
        value === "all"
          ? undefined
          : scoped.filter((entry) => matchesChatsChip(entry, value)).length,
    }));
  }, [entries, scope, t]);
  const actions = useChatRowActions(
    catalog.chatRows,
    onBeforeNavigate,
    catalog.chats.loadState.status === "loaded",
  );
  const empty =
    entries.length === 0 ? "navigation.lists.emptyChats" : "navigation.lists.emptyChatsFiltered";
  const emptyText = t(empty);
  const emptyView = useMemo(() => <Text style={styles.empty}>{emptyText}</Text>, [emptyText]);
  const headerActions = useMemo(
    () => (
      <>
        <HeaderSearchButton onPress={toggleSearch} testID="chats-search" />
        <NewChatMenu />
      </>
    ),
    [toggleSearch],
  );
  return (
    <View style={styles.pane} testID="chats-pane">
      <SectionHeader title={t("navigation.sections.chats")} actions={headerActions} />
      {searchOpen ? (
        <View style={styles.search}>
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder={t("navigation.lists.searchChats")}
            clearAccessibilityLabel={t("navigation.actions.closeSearch")}
            testID="chats-search-input"
          />
        </View>
      ) : null}
      <View style={styles.controls}>
        <ScopeTabs section="chats" counts={chatScopeCounts(entries)} />
        <View style={styles.chips}>
          <FilterChips chips={chips} value={chip} onChange={setChip} scroll testID="chats-chip" />
        </View>
        <DisplayRow />
      </View>
      <FlatList
        {...handlers}
        data={rows}
        keyExtractor={entryKey}
        renderItem={actions.renderItem}
        extraData={actions.selection}
        contentContainerStyle={styles.list}
        ListEmptyComponent={emptyView}
        testID="chats-list"
      />
      <PinOptionsMenu {...actions.menuProps} />
    </View>
  );
}

const entryKey = (entry: ChatsEntry) => entry.key;
const botIcon = <HeaderMenuIcon Icon={Bot} />;
const groupIcon = <HeaderMenuIcon Icon={Hash} />;

function useChatRowActions(
  chatRows: Parameters<typeof useBotSidebarActions>[0],
  onBeforeNavigate: ChatListAdmission | undefined,
  loaded: boolean,
) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const current = parseChatRouteFromPathname(pathname);
  const selectedBot = selectedDirectBotKey(chatRows, current);
  const { openBot, navigate } = useBotSidebarActions(chatRows, onBeforeNavigate, loaded);
  const menu = useSidebarPinMenu(onBeforeNavigate, chatRows);
  const pressBot = useCallback(
    (bot: BotsSidebarBot) => void openBot(bot.serverId, bot.botId),
    [openBot],
  );
  const pressChat = useCallback(
    (chat: ChatsSidebarChat) => navigate(chat.serverId, chat.chatId),
    [navigate],
  );
  const selection = `${selectedBot ?? ""}|${current?.serverId ?? ""}:${current?.chatId ?? ""}`;
  const renderItem = useCallback(
    ({ item }: { item: ChatsEntry }) => {
      if (item.bot)
        return (
          <BotRow
            bot={item.bot}
            pinned={item.pinned}
            selected={selectedBot === item.bot.key}
            onPress={pressBot}
            onOpenMenu={menu.onBotMenu}
          />
        );
      if (!item.group) return null;
      return (
        <ChatRow
          chat={item.group}
          pinned={item.pinned}
          selected={
            current?.serverId === item.group.serverId && current.chatId === item.group.chatId
          }
          onPress={pressChat}
          onOpenMenu={menu.onChatMenu}
        />
      );
    },
    [current, menu.onBotMenu, menu.onChatMenu, pressBot, pressChat, selectedBot],
  );
  const menuProps = {
    anchor: menu.menu?.anchor,
    visible: menu.menu !== null,
    title:
      menu.menu?.kind === "bot"
        ? t("bots.workspace.shared.bot")
        : t("bots.workspace.sidebar.groupChat"),
    actions: menu.actions,
    onSelect: menu.selectAction,
    onClose: menu.closeMenu,
  };
  return { renderItem, selection, menuProps };
}

/** ✎: message a bot or start a group (brief 3.1a); the creation sheets stay where they were. */
function NewChatMenu() {
  const { t } = useTranslation();
  const canCreate = useCreationRequest((state) => state.handlers > 0);
  const ask = useCreationRequest((state) => state.ask);
  const creationHosts = useBotCreationHosts();
  const newBot = useCallback(() => ask("bot"), [ask]);
  const newGroup = useCallback(() => ask("group"), [ask]);
  return (
    <DropdownMenu>
      <ToolbarButton kind="menu" label={t("navigation.actions.newChat")} testID="chats-new">
        <HeaderMenuIcon Icon={SquarePen} />
      </ToolbarButton>
      <DropdownMenuContent align="end" width={220} sheetTitle={t("navigation.actions.newChat")}>
        <DropdownMenuItem
          leading={botIcon}
          disabled={!canCreate || creationHosts.length === 0}
          onSelect={newBot}
          testID="chats-new-bot"
        >
          {t("navigation.actions.newBotChat")}
        </DropdownMenuItem>
        <DropdownMenuItem
          leading={groupIcon}
          disabled={!canCreate}
          onSelect={newGroup}
          testID="chats-new-group"
        >
          {t("navigation.actions.newGroup")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The existing Bots and Group chats display menus: what rows show and which Hosts they list. */
function DisplayRow() {
  const { t } = useTranslation();
  return (
    <View style={styles.display}>
      <Text style={styles.displayLabel}>{t("bots.workspace.shared.bots")}</Text>
      <SectionDisplayMenu section="bots" />
      <Text style={styles.displayLabel}>{t("bots.workspace.shared.groupChats")}</Text>
      <SectionDisplayMenu section="chats" />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  pane: { flex: 1, minHeight: 0 },
  search: { paddingHorizontal: theme.spacing[3], paddingBottom: theme.spacing[2] },
  controls: { gap: theme.spacing[2], paddingBottom: theme.spacing[2] },
  chips: { paddingHorizontal: theme.spacing[3] },
  display: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
  },
  displayLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  list: { paddingHorizontal: theme.spacing[2], paddingBottom: theme.spacing[4] },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[4],
    textAlign: "center",
  },
}));
