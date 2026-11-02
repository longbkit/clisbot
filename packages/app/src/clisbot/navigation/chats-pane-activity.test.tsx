// @vitest-environment jsdom
import React, { useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(), removeItem: vi.fn() },
}));
const state = vi.hoisted(() => ({
  titles: ["first"],
  listeners: new Set<() => void>(),
  profiles: new Map<string, number>(),
}));

/** One Chats entry the real list ordering accepts in the For me scope. */
function entry(title: string) {
  return {
    key: `chat:srv:${title}`,
    kind: "group" as const,
    serverId: "srv",
    title,
    updatedAt: "2026-10-01T00:00:00.000Z",
    pinned: false,
    pinIndex: undefined,
    ownership: "mine" as const,
    unread: false,
    company: false,
    group: { key: `srv:${title}`, serverId: "srv", chatId: title, title },
  };
}
const catalog = {
  hosts: [],
  bots: { loadState: { status: "loaded" } },
  chats: { loadState: { status: "loaded" } },
  botRows: [],
  chatRows: [],
};
function subscribe(listener: () => void) {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}
function publish(titles: string[]) {
  act(() => {
    state.titles = titles;
    for (const notify of state.listeners) notify();
  });
}

vi.mock("./use-chat-entries", () => ({
  // A Host update builds new entries, as the real catalog does.
  useChatEntries: () => {
    const titles = useSyncExternalStore(subscribe, () => state.titles);
    return { entries: titles.map(entry), catalog };
  },
}));
vi.mock("@/utils/render-profiler", () => ({
  RenderProfile: ({ id, children }: { id: string; children: React.ReactNode }) => {
    state.profiles.set(id, (state.profiles.get(id) ?? 0) + 1);
    return <div>{children}</div>;
  },
}));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => true }));
vi.mock("react-native", () => ({
  StyleSheet: {
    compose: (base: object, extra: object) => [base, extra],
    create: (styles: object) => styles,
  },
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
// Press-in preloading reaches the Host runtime; this suite only counts pane renders.
vi.mock("@/open-preload/live", () => ({
  openPreloads: { pressIn: () => undefined, top: () => undefined, cancel: () => undefined },
}));
vi.mock("@/clisbot/bots/data/resource-principal-scope", () => ({
  useResourcePrincipalScope: () => null,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("lucide-react-native", () => ({
  Bot: () => null,
  Hash: () => null,
  SquarePen: () => null,
  X: () => null,
}));
vi.mock("expo-router", () => ({ usePathname: () => "/chat" }));
vi.mock("@/components/ui/scroll-view", () => ({
  FlatList: <T,>({
    data,
    keyExtractor,
    renderItem,
    ListHeaderComponent,
    testID,
  }: {
    data: T[];
    keyExtractor: (item: T) => string;
    renderItem: (info: { item: T }) => React.ReactNode;
    ListHeaderComponent?: React.ReactNode;
    testID?: string;
  }) => (
    <div data-testid={testID}>
      {ListHeaderComponent}
      {data.map((item) => (
        <React.Fragment key={keyExtractor(item)}>{renderItem({ item })}</React.Fragment>
      ))}
    </div>
  ),
}));
vi.mock("@/clisbot/bots/sidebar/bots-section", () => ({ BotRow: () => null }));
vi.mock("@/clisbot/bots/sidebar/row", () => ({ BotsSidebarRowSkeleton: () => null }));
vi.mock("@/clisbot/bots/sidebar/chats-section", () => ({
  ChatRow: ({ chat }: { chat: { title: string } }) => (
    <div data-testid="chat-row">{chat.title}</div>
  ),
}));
vi.mock("@/clisbot/bots/sidebar/pin-options", () => ({ PinOptionsMenu: () => null }));
vi.mock("@/clisbot/bots/sidebar/use-section-actions", () => ({
  useSidebarPinMenu: () => ({
    menu: null,
    actions: [],
    onBotMenu: () => {},
    onChatMenu: () => {},
    selectAction: () => {},
    closeMenu: () => {},
  }),
}));
vi.mock("@/clisbot/bots/sidebar/use-sidebar-actions", () => ({
  useBotSidebarActions: () => ({ openBot: async () => {}, navigate: () => {} }),
}));
vi.mock("@/clisbot/bots/sidebar/creation-request", () => ({ useCreationRequest: () => 0 }));
vi.mock("@/clisbot/bots/data/runtime", () => ({ refreshBotsAndChats: () => {} }));
vi.mock("@/clisbot/bots/feature", () => ({ useBotCreationHosts: () => [] }));
vi.mock("@/clisbot/bots/routes", () => ({
  parseChatRouteFromPathname: () => null,
  isSameChatRoute: (left: unknown, right: unknown) => left === right,
}));
vi.mock("@/clisbot/bots/sidebar/sidebar-model", () => ({ selectedDirectBotKey: () => null }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: () => null,
  DropdownMenuContent: () => null,
  DropdownMenuItem: () => null,
}));
vi.mock("@/components/ui/pane-content-toolbar", () => ({ ToolbarButton: () => null }));
vi.mock("@/components/ui/search-field", () => ({
  SearchField: ({ testID, autoFocus }: { testID: string; autoFocus?: boolean }) => (
    // biome-ignore lint/a11y/noAutofocus: the stand-in mirrors the field's own autoFocus.
    <input data-testid={testID} autoFocus={autoFocus} />
  ),
}));
vi.mock("@/styles/theme", () => ({ SPACING: { 2: 8, 4: 16 } }));
vi.mock("./chats-display-menu", () => ({ ChatsDisplayMenu: () => null }));
vi.mock("./hosts-status", () => ({ useHostsReachability: () => "online" }));
vi.mock("./hosts-unreachable-state", () => ({ HostsUnreachableState: () => null }));
vi.mock("./list-state", () => ({ ListState: () => null }));
vi.mock("./outside-filter-notice", () => ({ OutsideFilterNotice: () => null }));
vi.mock("./held-order", () => ({ useHeldOrder: () => ({ held: null, handlers: {} }) }));
vi.mock("./section-controls", () => ({
  SectionControls: () => null,
  useSectionBackdrop: () => "surfaceSidebar",
}));
vi.mock("./section-header", () => {
  const Button = ({ onPress, testID }: { onPress: () => void; testID: string }) => (
    <button type="button" data-testid={testID} onClick={onPress} />
  );
  return {
    HeaderIconButton: Button,
    HeaderMenuButton: () => null,
    HeaderMenuIcon: () => null,
    HeaderSearchButton: Button,
    SECTION_MENU_WIDTH: 240,
    SectionHeader: ({ title, actions }: { title: React.ReactNode; actions: React.ReactNode }) => (
      <div data-testid="chats-header">
        {title}
        {actions}
      </div>
    ),
  };
});
vi.mock("./host-filter", () => ({ useHostFilterIds: () => [] }));

import { RetainedPanelActivity } from "@/components/retained-panel";
import { ChatsPane } from "./chats-pane";
import { useNavigationStore } from "./store";
import { RouteSourceProvider } from "@/navigation/route-source";
import { createReadRouteSource } from "@/test/route-source";

const setSearch = vi.fn();

const routes = createReadRouteSource(() => "/chat");

function Chats({ shown }: { shown: boolean }) {
  return (
    <RouteSourceProvider source={routes}>
      <RetainedPanelActivity active={shown}>
        <ChatsPane search="" setSearch={setSearch} />
      </RetainedPanelActivity>
    </RouteSourceProvider>
  );
}

function bodyRenders(): number {
  return state.profiles.get("NavChats") ?? 0;
}

function rows(): string[] {
  return screen.queryAllByTestId("chat-row").map((row) => row.textContent ?? "");
}

afterEach(() => {
  cleanup();
  state.listeners.clear();
  state.titles = ["first"];
  state.profiles.clear();
  setSearch.mockClear();
  useNavigationStore.setState({ chatsSearchOpen: false });
});

describe("ChatsPane while its retained panel is hidden", () => {
  it("renders every Host update while shown", () => {
    render(<Chats shown />);
    state.profiles.clear();
    publish(["first", "second"]);
    expect(bodyRenders()).toBe(1);
    expect(rows()).toEqual(["first", "second"]);
  });

  it("does not render its body on Host updates", () => {
    const view = render(<Chats shown />);
    view.rerender(<Chats shown={false} />);
    state.profiles.clear();
    publish(["first", "second"]);
    publish(["first", "second", "third"]);
    expect(bodyRenders()).toBe(0);
    expect(rows()).toEqual(["first"]);
  });

  it("shows the latest entries in the first render back", () => {
    const view = render(<Chats shown />);
    view.rerender(<Chats shown={false} />);
    publish(["first", "second", "third"]);
    state.profiles.clear();
    view.rerender(<Chats shown />);
    expect(bodyRenders()).toBe(1);
    expect(rows()).toEqual(["first", "second", "third"]);
  });
});

describe("Chats search", () => {
  it("opens in the header, focused, and renders neither the list nor a row", () => {
    state.titles = ["first", "second", "third"];
    render(<Chats shown />);
    state.profiles.clear();
    fireEvent.click(screen.getByTestId("chats-search"));
    const field = screen.getByTestId("chats-search-input");
    // In the header, so it opens in view however far the list is scrolled, and takes the keyboard.
    expect(within(screen.getByTestId("chats-header")).getByTestId("chats-search-input")).toBe(
      field,
    );
    expect(within(screen.getByTestId("chats-list")).queryByTestId("chats-search-input")).toBe(null);
    expect(document.activeElement).toBe(field);
    expect(bodyRenders()).toBe(0);
    expect([...state.profiles.keys()].filter((id) => id.startsWith("ChatsRow:"))).toEqual([]);
  });

  it("closes with ✕ and clears the query", () => {
    render(<Chats shown />);
    fireEvent.click(screen.getByTestId("chats-search"));
    fireEvent.click(screen.getByTestId("chats-search-close"));
    expect(screen.queryByTestId("chats-search-input")).toBe(null);
    expect(screen.getByTestId("chats-search")).toBeTruthy();
    expect(setSearch).toHaveBeenCalledWith("");
  });
});
