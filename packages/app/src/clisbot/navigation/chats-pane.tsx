import {
  memo,
  useCallback,
  useMemo,
  type ComponentProps,
  type Dispatch,
  type SetStateAction,
} from "react";
import equal from "fast-deep-equal";
import { Text, View } from "react-native";
import { FlatList } from "@/components/ui/scroll-view";
import { openPreloads } from "@/open-preload/live";
import { rememberChatOpenPreview } from "@/clisbot/bots/chat/open-preview";
import { useResourcePrincipalScope } from "@/clisbot/bots/data/resource-principal-scope";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Bot, Hash, SquarePen } from "lucide-react-native";
import { usePathname } from "expo-router";
import { BotRow, type BotsSidebarBot } from "@/clisbot/bots/sidebar/bots-section";
import { BotsSidebarRowSkeleton } from "@/clisbot/bots/sidebar/row";
import { ChatRow, type ChatsSidebarChat } from "@/clisbot/bots/sidebar/chats-section";
import { PinOptionsMenu } from "@/clisbot/bots/sidebar/pin-options";
import { useSidebarPinMenu } from "@/clisbot/bots/sidebar/use-section-actions";
import { useBotSidebarActions } from "@/clisbot/bots/sidebar/use-sidebar-actions";
import { useCreationRequest } from "@/clisbot/bots/sidebar/creation-request";
import { refreshBotsAndChats } from "@/clisbot/bots/data/runtime";
import { useBotCreationHosts } from "@/clisbot/bots/feature";
import { parseChatRouteFromPathname } from "@/clisbot/bots/routes";
import { selectedDirectBotKey } from "@/clisbot/bots/sidebar/sidebar-model";
import type { ChatListAdmission } from "@/clisbot/home/use-chat-list-navigation";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { FilterChip } from "@/components/ui/filter-chips";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { SearchField } from "@/components/ui/search-field";
import {
  CHATS_CHIPS,
  chatListItems,
  chatScopeCounts,
  matchesChatsChip,
  orderChatList,
  type ChatsChip,
  type ChatsListItem,
} from "./chat-list";
import { ChatsDisplayMenu } from "./chats-display-menu";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useHeldWhileInactive } from "@/hooks/use-held-while-inactive";
import { useStableEvent } from "@/hooks/use-stable-event";
import { RenderProfile } from "@/utils/render-profiler";
import { SPACING } from "@/styles/theme";
import { useHostsReachability } from "./hosts-status";
import { HostsUnreachableState } from "./hosts-unreachable-state";
import { ListState } from "./list-state";
import { OutsideFilterNotice } from "./outside-filter-notice";
import { useHeldOrder } from "./held-order";
import { inScope, type OwnershipScope } from "./ownership";
import { SectionControls } from "./section-controls";
import {
  HeaderMenuIcon,
  HeaderSearchButton,
  SECTION_MENU_WIDTH,
  SectionHeader,
} from "./section-header";
import { useNavigationStore } from "./store";
import { useChatEntries, type ChatsEntry } from "./use-chat-entries";
import { useHostFilterIds } from "./host-filter";

const CHIP_LABELS: Record<ChatsChip, string> = {
  all: "navigation.chips.all",
  unread: "navigation.chips.unread",
  bot: "navigation.chips.botDm",
  groups: "navigation.chips.groups",
  personal: "navigation.chips.personal",
  company: "navigation.chips.company",
};

interface ChatsPaneProps {
  onBeforeNavigate?: ChatListAdmission;
  searchOpen: boolean;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
}

/**
 * Chats (brief C3): one Telegram-style list of Bot DMs and group chats, pins on top. This owner
 * reads the catalog and holds it while the pane's retained panel is hidden, so Host updates skip
 * the list until it is shown again.
 */
export const ChatsPane = memo(function ChatsPane(props: ChatsPaneProps) {
  const active = useRetainedPanelActive();
  const { entries, catalog } = useHeldWhileInactive(useChatEntries(active), active);
  return <ChatsPaneContent {...props} entries={entries} catalog={catalog} />;
});

type ChatEntries = ReturnType<typeof useChatEntries>;

const ChatsPaneContent = memo(function ChatsPaneContent({
  onBeforeNavigate,
  searchOpen,
  setSearchOpen,
  search,
  setSearch,
  entries,
  catalog,
}: ChatsPaneProps & ChatEntries) {
  const { t } = useTranslation();
  const scope = useNavigationStore((state) => state.scopes.chats);
  const chip = useNavigationStore((state) => state.chatsChip);
  const setChip = useNavigationStore((state) => state.setChatsChip);
  const toggleSearch = useCallback(() => {
    setSearchOpen((open) => !open);
    setSearch("");
  }, [setSearch, setSearchOpen]);
  const sort = useNavigationStore((state) => state.chatsSort);
  const split = useNavigationStore((state) => state.chatsSplit);
  const serverIds = useHostFilterIds();
  const query = useMemo(
    () => ({ entries, scope, chip, search, sort, serverIds }),
    [entries, scope, chip, search, sort, serverIds],
  );
  const fresh = useMemo(() => orderChatList(query), [query]);
  const freshKeys = useMemo(() => fresh.map((entry) => entry.key), [fresh]);
  const { held, handlers } = useHeldOrder(freshKeys);
  // A drag means the touch that pressed a row in was a scroll, not a tap.
  const beginDrag = useCallback(() => {
    handlers.onScrollBeginDrag();
    openPreloads.cancelQueued();
  }, [handlers]);
  const items = useMemo(
    () => chatListItems(held ? orderChatList({ ...query, held }) : fresh, split),
    [held, fresh, query, split],
  );
  const chips = useMemo(() => chatsChips(entries, scope, t), [entries, scope, t]);
  const actions = useChatRowActions(
    catalog.chatRows,
    onBeforeNavigate,
    catalog.chats.loadState.status === "loaded",
  );
  const emptyView = useMemo(
    () => <ChatsListState catalog={catalog} filtered={entries.length > 0} />,
    [catalog, entries.length],
  );
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
    <RenderProfile id="NavChats">
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
        <SectionControls
          section="chats"
          scopeCounts={chatScopeCounts(entries)}
          chips={chips}
          chip={chip}
          onChip={setChip}
          backdrop="surfaceSidebar"
          display={displayMenu}
        />
        <OutsideFilterNotice list="chats" />
        <FlatList
          {...handlers}
          onScrollBeginDrag={beginDrag}
          data={items}
          keyExtractor={itemKey}
          renderItem={actions.renderItem}
          extraData={actions.selection}
          contentContainerStyle={LIST_CONTENT}
          ListEmptyComponent={emptyView}
          testID="chats-list"
        />
        <PinOptionsMenu {...actions.menuProps} />
      </View>
    </RenderProfile>
  );
});

const displayMenu = <ChatsDisplayMenu />;

function chatsChips(
  entries: readonly ChatsEntry[],
  scope: OwnershipScope,
  t: (key: string) => string,
): FilterChip<ChatsChip>[] {
  const scoped = entries.filter((entry) => inScope(scope, entry.ownership));
  return CHATS_CHIPS.map((value) => ({
    value,
    label: t(CHIP_LABELS[value]),
    count:
      value === "all" ? undefined : scoped.filter((entry) => matchesChatsChip(entry, value)).length,
  }));
}

/** Chats with no rows: still loading, failed on every Host, or empty (or filtered to nothing). */
function ChatsListState({
  catalog,
  filtered,
}: {
  catalog: ChatEntries["catalog"];
  filtered: boolean;
}) {
  const { t } = useTranslation();
  const { bots, chats } = catalog;
  const retryLabel = t("navigation.actions.retry");
  const retry = useMemo(() => ({ label: retryLabel, onPress: refreshBotsAndChats }), [retryLabel]);
  const reach = useHostsReachability();
  const loaded = bots.loadState.status === "loaded" || chats.loadState.status === "loaded";
  if (!loaded && reach === "unreachable") return <HostsUnreachableState testID="chats-offline" />;
  if (!loaded && !bots.error && !chats.error) return <BotsSidebarRowSkeleton />;
  if (!loaded)
    return (
      <ListState
        kind="error"
        title={t("navigation.lists.chatsFailed")}
        action={retry}
        testID="chats-list-error"
      />
    );
  return (
    <ListState
      kind="empty"
      title={t(filtered ? "navigation.lists.emptyChatsFiltered" : "navigation.lists.emptyChats")}
      testID="chats-list-empty"
    />
  );
}
const itemKey = (item: ChatsListItem<ChatsEntry>) => item.key;

interface ChatsListEntryProps {
  entry: ChatsEntry;
  selected: boolean;
  onPressBot: (bot: BotsSidebarBot) => void;
  onPressChat: (chat: ChatsSidebarChat) => void;
  onPressInChat: (chat: ChatsSidebarChat) => void;
  onBotMenu: ComponentProps<typeof BotRow>["onOpenMenu"];
  onChatMenu: ComponentProps<typeof ChatRow>["onOpenMenu"];
}

/**
 * One Chats row. The list rebuilds its entries on every catalog change, so a row compares its
 * entry by value: a rename or a new message re-renders that row only (acceptance P5). Profiled
 * inside the memo, so a skipped row records nothing.
 */
const ChatsListEntry = memo(function ChatsListEntry({
  entry,
  selected,
  onPressBot,
  onPressChat,
  onPressInChat,
  onBotMenu,
  onChatMenu,
}: ChatsListEntryProps) {
  return (
    <RenderProfile id={`ChatsRow:${entry.key}`}>
      {entry.bot ? (
        <BotRow
          bot={entry.bot}
          pinned={entry.pinned}
          selected={selected}
          onPress={onPressBot}
          onOpenMenu={onBotMenu}
        />
      ) : null}
      {!entry.bot && entry.group ? (
        <ChatRow
          chat={entry.group}
          pinned={entry.pinned}
          selected={selected}
          onPress={onPressChat}
          onPressIn={onPressInChat}
          onOpenMenu={onChatMenu}
        />
      ) : null}
    </RenderProfile>
  );
}, sameRowProps);

function sameRowProps(previous: ChatsListEntryProps, next: ChatsListEntryProps): boolean {
  return (
    previous.selected === next.selected &&
    previous.onPressBot === next.onPressBot &&
    previous.onPressChat === next.onPressChat &&
    previous.onPressInChat === next.onPressInChat &&
    previous.onBotMenu === next.onBotMenu &&
    previous.onChatMenu === next.onChatMenu &&
    equal(previous.entry, next.entry)
  );
}
const botIcon = <HeaderMenuIcon Icon={Bot} />;
const groupIcon = <HeaderMenuIcon Icon={Hash} />;

function useChatRowActions(
  chatRows: Parameters<typeof useBotSidebarActions>[0],
  onBeforeNavigate: ChatListAdmission | undefined,
  loaded: boolean,
) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const current = useMemo(() => parseChatRouteFromPathname(pathname), [pathname]);
  const selectedBot = selectedDirectBotKey(chatRows, current);
  const { openBot, navigate } = useBotSidebarActions(chatRows, onBeforeNavigate, loaded);
  const menu = useSidebarPinMenu(onBeforeNavigate, chatRows);
  const pressBot = useStableEvent((bot: BotsSidebarBot) => void openBot(bot.serverId, bot.botId));
  const pressChat = useStableEvent((chat: ChatsSidebarChat) =>
    navigate(chat.serverId, chat.chatId),
  );
  const presentationScope = useResourcePrincipalScope();
  const pressInChat = useStableEvent(({ serverId, chatId, title }: ChatsSidebarChat) => {
    rememberChatOpenPreview({ serverId, chatId, title });
    openPreloads.preloadChat({ serverId, chatId, presentationScope });
  });
  const botMenu = useStableEvent(menu.onBotMenu);
  const chatMenu = useStableEvent(menu.onChatMenu);
  const selection = `${selectedBot ?? ""}|${current?.serverId ?? ""}:${current?.chatId ?? ""}`;
  const renderItem = useCallback(
    ({ item: listItem }: { item: ChatsListItem<ChatsEntry> }) => {
      if (listItem.type === "heading")
        return (
          <Text style={styles.heading}>
            {t(listItem.kind === "bot" ? "navigation.chips.botDm" : "navigation.chips.groups")}
          </Text>
        );
      const entry = listItem.entry;
      const selected = entry.bot
        ? selectedBot === entry.bot.key
        : current?.serverId === entry.group?.serverId && current?.chatId === entry.group?.chatId;
      return (
        <ChatsListEntry
          entry={entry}
          selected={selected}
          onPressBot={pressBot}
          onPressChat={pressChat}
          onPressInChat={pressInChat}
          onBotMenu={botMenu}
          onChatMenu={chatMenu}
        />
      );
    },
    [botMenu, chatMenu, current, pressBot, pressChat, pressInChat, selectedBot, t],
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
      <DropdownMenuContent
        align="end"
        width={SECTION_MENU_WIDTH}
        sheetTitle={t("navigation.actions.newChat")}
      >
        <DropdownMenuItem
          leading={botIcon}
          disabled={!canCreate || creationHosts.length === 0}
          onSelect={newBot}
          testID="chats-new-bot"
        >
          {t("navigation.actions.newBot")}
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

const styles = StyleSheet.create((theme) => ({
  pane: { flex: 1, minHeight: 0 },
  search: { paddingHorizontal: theme.spacing[3], paddingBottom: theme.spacing[2] },
  heading: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[1],
  },
}));

// Theme-free on purpose: a FlatList's content container never gets a Unistyles class on web
// (docs/unistyles.md, contentContainerStyle).
const LIST_CONTENT = { paddingHorizontal: SPACING[2], paddingBottom: SPACING[4] };
