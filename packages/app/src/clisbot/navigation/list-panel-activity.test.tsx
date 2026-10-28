// @vitest-environment jsdom
import React, { useCallback, useState, useSyncExternalStore } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(), removeItem: vi.fn() },
}));
const state = vi.hoisted(() => ({
  compact: true,
  os: "android",
  sessions: ["mine"],
  listeners: new Set<() => void>(),
  chats: ["first"],
  chatListeners: new Set<() => void>(),
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return state.os;
    },
  },
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({ content: {}, panel: {}, desktop: {} }) },
}));
vi.mock("expo-router", () => ({ usePathname: () => "/work" }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => state.compact }));
vi.mock("@/components/retained-panel", () => ({
  RetainedPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  RetainedPanelActivity: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("./work-pane", () => ({
  WorkPane: () => {
    const scope = useNavigationStore((value) => value.scopes.work);
    const chip = useNavigationStore((value) => value.workChip);
    const lastList = useNavigationStore((value) => value.lastList);
    const sessions = useSyncExternalStore(
      (listener) => {
        state.listeners.add(listener);
        return () => state.listeners.delete(listener);
      },
      () => state.sessions,
    );
    return (
      <div data-testid="work">
        <div data-testid="work-preferences">{`${scope}:${chip}:${lastList}`}</div>
        {sessions.map((session) => (
          <div key={session} data-testid="work-row">
            {session}
          </div>
        ))}
      </div>
    );
  },
}));
vi.mock("./chats-pane", () => ({
  ChatsPane: (props: {
    search?: string;
    setSearch?: (value: string) => void;
    searchOpen?: boolean;
    setSearchOpen?: (value: boolean) => void;
  }) => {
    const [localSearch, setLocalSearch] = useState("");
    const [localSearchOpen, setLocalSearchOpen] = useState(false);
    const scope = useNavigationStore((value) => value.scopes.chats);
    const chip = useNavigationStore((value) => value.chatsChip);
    const lastList = useNavigationStore((value) => value.lastList);
    const chats = useSyncExternalStore(
      (listener) => {
        state.chatListeners.add(listener);
        return () => state.chatListeners.delete(listener);
      },
      () => state.chats,
    );
    const search = props.search ?? localSearch;
    const searchOpen = props.searchOpen ?? localSearchOpen;
    const setSearchOpen = props.setSearchOpen ?? setLocalSearchOpen;
    const setSearch = props.setSearch ?? setLocalSearch;
    const openSearch = useCallback(() => setSearchOpen(true), [setSearchOpen]);
    const changeSearch = useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => setSearch(event.target.value),
      [setSearch],
    );
    return (
      <div data-testid="chats">
        <div>Chats</div>
        <div data-testid="chats-preferences">{`${scope}:${chip}:${lastList}`}</div>
        <button type="button" onClick={openSearch}>
          Search
        </button>
        {searchOpen ? (
          <input aria-label="Chat search" value={search} onChange={changeSearch} />
        ) : null}
        {chats.map((chat) => (
          <div key={chat} data-testid="chat-row">
            {chat}
          </div>
        ))}
      </div>
    );
  },
}));
vi.mock("@/clisbot/bots/feature", () => ({
  useBotsFeatureHosts: () => [],
  useBotCreationHosts: () => [],
}));
vi.mock("@/clisbot/bots/sidebar/sections", () => ({}));
vi.mock("@/clisbot/bots/sidebar/use-section-actions", () => ({}));
vi.mock("@/clisbot/bots/sidebar/use-sidebar-actions", () => ({}));
vi.mock("@/clisbot/home/mobile-navigation", () => ({ MobileChatPanelTabs: () => null }));
vi.mock("@/clisbot/home/pending-chat-presentation", () => ({
  PendingChatPresentation: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/clisbot/home/use-chat-list-navigation", () => ({}));
vi.mock("@/components/desktop-sidebar-frame", () => ({}));
vi.mock("@/mobile-panels/gestures", () => ({}));
vi.mock("@/mobile-panels/presentation", () => ({}));
vi.mock("@/stores/panel-store", () => ({}));
vi.mock("@/utils/desktop-window", () => ({}));
vi.mock("./rail", () => ({}));
vi.mock("./sections", () => ({ CHATS_PATH: "/chat", WORK_PATH: "/work" }));
vi.mock("./search-integration", () => ({}));
vi.mock("./use-open-section", () => ({}));
vi.mock("./opened-session", () => ({}));

import { ListContent } from "./list-panel";
import { useNavigationStore } from "./store";

afterEach(() => {
  cleanup();
  state.listeners.clear();
  state.chatListeners.clear();
  state.sessions = ["mine"];
  state.chats = ["first"];
  state.compact = true;
  state.os = "android";
  useNavigationStore.setState({
    scopes: { home: "mine", chats: "mine", work: "mine" },
    workChip: "all",
    chatsChip: "all",
    lastList: "work",
  });
});

describe("retained Chats list activity", () => {
  it("does not mount or rebuild rows while hidden and shows current rows on return", () => {
    const view = render(<ListContent section="chats" active />);
    expect(screen.getByTestId("chat-row").textContent).toBe("first");
    view.rerender(<ListContent section="chats" active={false} />);
    expect(screen.queryByTestId("chats")).toBeNull();
    expect(state.chatListeners.size).toBe(0);
    state.chats = ["first", "new"];
    for (const notify of state.chatListeners) notify();
    expect(screen.queryAllByTestId("chat-row")).toHaveLength(0);
    view.rerender(<ListContent section="chats" active />);
    expect(screen.getAllByTestId("chat-row").map((row) => row.textContent)).toEqual([
      "first",
      "new",
    ]);
  });

  it("keeps scope, chip and an open search across release and return", () => {
    useNavigationStore.setState({
      scopes: { home: "mine", chats: "others", work: "mine" },
      chatsChip: "unread",
      lastList: "chats",
    });
    const view = render(<ListContent section="chats" active />);
    fireEvent.click(screen.getByText("Search"));
    fireEvent.change(screen.getByLabelText("Chat search"), { target: { value: "project" } });
    view.rerender(<ListContent section="work" active />);
    expect(screen.queryByTestId("chats")).toBeNull();
    view.rerender(<ListContent section="chats" active />);
    expect(screen.getByTestId("chats-preferences").textContent).toBe("others:unread:chats");
    expect((screen.getByLabelText("Chat search") as HTMLInputElement).value).toBe("project");
  });

  it("retains Chats on desktop and iOS", () => {
    state.compact = false;
    const desktop = render(<ListContent section="chats" active />);
    desktop.rerender(<ListContent section="work" active={false} />);
    expect(screen.getByTestId("chat-row").textContent).toBe("first");
    desktop.unmount();
    state.compact = true;
    state.os = "ios";
    const ios = render(<ListContent section="chats" active />);
    ios.rerender(<ListContent section="work" active={false} />);
    expect(screen.getByTestId("chat-row").textContent).toBe("first");
  });
});

describe("retained Workspace list activity", () => {
  it("does not mount or rebuild rows while the compact panel is hidden and shows current rows on return", () => {
    const view = render(<ListContent section="work" active />);
    expect(screen.getAllByTestId("work-row").map((row) => row.textContent)).toEqual(["mine"]);
    view.rerender(<ListContent section="work" active={false} />);
    expect(screen.queryByTestId("work")).toBeNull();
    expect(state.listeners.size).toBe(0);
    state.sessions = ["mine", "new"];
    for (const notify of state.listeners) notify();
    expect(screen.queryAllByTestId("work-row")).toHaveLength(0);
    view.rerender(<ListContent section="work" active />);
    expect(screen.getAllByTestId("work-row").map((row) => row.textContent)).toEqual([
      "mine",
      "new",
    ]);
  });
  it("does not mount a remembered Work list while the panel starts hidden", () => {
    render(<ListContent section="work" active={false} />);
    expect(screen.queryByTestId("work")).toBeNull();
    expect(state.listeners.size).toBe(0);
  });
  it("keeps the selected list, scope and chip when Work is released and shown again", () => {
    useNavigationStore.setState({
      scopes: { home: "mine", chats: "mine", work: "others" },
      workChip: "running",
      lastList: "work",
    });
    const view = render(<ListContent section="work" active />);
    expect(screen.getByTestId("work-preferences").textContent).toBe("others:running:work");
    view.rerender(<ListContent section="work" active={false} />);
    expect(screen.queryByTestId("work")).toBeNull();
    view.rerender(<ListContent section="work" active />);
    expect(screen.getByTestId("work-preferences").textContent).toBe("others:running:work");
  });
  it("releases Work when switching to Chats on a compact screen", () => {
    const view = render(<ListContent section="work" active />);
    view.rerender(<ListContent section="chats" active />);
    expect(screen.queryByTestId("work")).toBeNull();
    expect(screen.getByText("Chats").textContent).toBe("Chats");
    state.sessions = ["other"];
    for (const notify of state.listeners) notify();
    expect(screen.queryAllByTestId("work-row")).toHaveLength(0);
    view.rerender(<ListContent section="work" active />);
    expect(screen.getAllByTestId("work-row").map((row) => row.textContent)).toEqual(["other"]);
  });
  it("keeps the desktop Work list mounted when hidden", () => {
    state.compact = false;
    const view = render(<ListContent section="work" active />);
    view.rerender(<ListContent section="chats" active={false} />);
    expect(screen.getByTestId("work-row").textContent).toBe("mine");
  });
  it("retains Work on iOS", () => {
    state.os = "ios";
    const view = render(<ListContent section="work" active />);
    view.rerender(<ListContent section="chats" active={false} />);
    expect(screen.getByTestId("work-row").textContent).toBe("mine");
  });
});
