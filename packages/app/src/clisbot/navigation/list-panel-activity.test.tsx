// @vitest-environment jsdom
import React, { memo, useCallback, useEffect, useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(), removeItem: vi.fn() },
}));
const state = vi.hoisted(() => ({
  compact: true,
  sessions: ["mine"],
  chats: ["first"],
  listeners: new Set<() => void>(),
  mounts: { work: 0, chats: 0 },
  bodyRenders: { work: 0, chats: 0 },
  /** The `active` prop of each Work pane render. */
  workActive: [] as (boolean | undefined)[],
}));
vi.mock("react-native", () => ({
  StyleSheet: {
    compose: (base: object, extra: object) => [base, extra],
    create: (styles: object) => styles,
  },
  View: ({ children, pointerEvents }: { children: React.ReactNode; pointerEvents?: string }) => (
    <div data-pointer-events={pointerEvents}>{children}</div>
  ),
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({ content: {}, panel: {}, desktop: {} }) },
}));
vi.mock("expo-router", () => ({ usePathname: () => "/work" }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => state.compact }));

/** The fake Host store both panes read; `publish` is one Host update. */
function subscribe(listener: () => void) {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}
function publish(next: { sessions?: string[]; chats?: string[] }) {
  act(() => {
    if (next.sessions) state.sessions = next.sessions;
    if (next.chats) state.chats = next.chats;
    for (const notify of state.listeners) notify();
  });
}

/**
 * Both panes mirror the production shape: an owner reads the store and holds it while its retained
 * panel is hidden, and a memoized body renders the rows.
 */
vi.mock("./work-pane", async () => {
  const { useRetainedPanelActive } = await import("@/components/retained-panel");
  const { useHeldWhileInactive } = await import("@/hooks/use-held-while-inactive");
  const WorkBody = memo(function WorkBody({ sessions }: { sessions: string[] }) {
    state.bodyRenders.work += 1;
    const scope = useNavigationStore((value) => value.scopes.work);
    const chip = useNavigationStore((value) => value.workChip);
    const lastList = useNavigationStore((value) => value.lastList);
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
  });
  return {
    WorkPane: ({ active: paneActive }: { active?: boolean }) => {
      state.workActive.push(paneActive);
      useEffect(() => {
        state.mounts.work += 1;
      }, []);
      const active = useRetainedPanelActive();
      const sessions = useSyncExternalStore(subscribe, () => state.sessions);
      return <WorkBody sessions={useHeldWhileInactive(sessions, active)} />;
    },
  };
});
vi.mock("./chats-pane", async () => {
  const { useRetainedPanelActive } = await import("@/components/retained-panel");
  const { useHeldWhileInactive } = await import("@/hooks/use-held-while-inactive");
  interface ChatsBodyProps {
    chats: string[];
    search: string;
    setSearch: (value: string) => void;
    searchOpen: boolean;
    setSearchOpen: (value: boolean) => void;
  }
  const ChatsBody = memo(function ChatsBody(props: ChatsBodyProps) {
    state.bodyRenders.chats += 1;
    const scope = useNavigationStore((value) => value.scopes.chats);
    const chip = useNavigationStore((value) => value.chatsChip);
    const lastList = useNavigationStore((value) => value.lastList);
    const { setSearchOpen, setSearch } = props;
    const openSearch = useCallback(() => setSearchOpen(true), [setSearchOpen]);
    const changeSearch = useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => setSearch(event.target.value),
      [setSearch],
    );
    return (
      <div data-testid="chats">
        <div data-testid="chats-preferences">{`${scope}:${chip}:${lastList}`}</div>
        <button type="button" onClick={openSearch}>
          Search
        </button>
        {props.searchOpen ? (
          <input aria-label="Chat search" value={props.search} onChange={changeSearch} />
        ) : null}
        {props.chats.map((chat) => (
          <div key={chat} data-testid="chat-row">
            {chat}
          </div>
        ))}
      </div>
    );
  });
  return {
    ChatsPane: (props: Omit<ChatsBodyProps, "chats">) => {
      useEffect(() => {
        state.mounts.chats += 1;
      }, []);
      const active = useRetainedPanelActive();
      const chats = useSyncExternalStore(subscribe, () => state.chats);
      return <ChatsBody {...props} chats={useHeldWhileInactive(chats, active)} />;
    },
  };
});
vi.mock("@/clisbot/bots/feature", () => ({
  useBotsFeatureHosts: () => [],
  useBotCreationHosts: () => [],
}));
vi.mock("@/clisbot/bots/sidebar/sections", () => ({}));
vi.mock("@/clisbot/bots/sidebar/use-section-actions", () => ({}));
vi.mock("@/clisbot/bots/sidebar/use-sidebar-actions", () => ({}));
vi.mock("@/components/sidebar/sidebar-model", () => ({
  SidebarModelProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/workspace-shortcut-targets-subscriber", () => ({
  WorkspaceShortcutTargetsSubscriber: () => null,
}));
vi.mock("@/components/desktop-sidebar-frame", () => ({}));
vi.mock("@/utils/desktop-window", () => ({ WindowChromeSafeArea: () => null }));
vi.mock("./rail", () => ({}));
vi.mock("./sections", () => ({ CHATS_PATH: "/chat", WORK_PATH: "/work" }));
vi.mock("./search-integration", () => ({}));
vi.mock("./use-open-section", () => ({}));
vi.mock("./opened-session", () => ({}));

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { RetainedPanelActivity } from "@/components/retained-panel";
import { ListContent, PhoneListTab } from "./list-panel";
import { useNavigationStore, type ListSection } from "./store";

/** The list panel as the phone and desktop chrome mount it: an activity gate around the lists. */
function Lists({ section, active }: { section: ListSection; active: boolean }) {
  return (
    <RetainedPanelActivity active={active}>
      <ListContent section={section} active={active} />
    </RetainedPanelActivity>
  );
}

function rows(testId: string): string[] {
  return screen.queryAllByTestId(testId).map((row) => row.textContent ?? "");
}

function resetRenderCounts() {
  state.bodyRenders.work = 0;
  state.bodyRenders.chats = 0;
}

afterEach(() => {
  cleanup();
  state.listeners.clear();
  state.sessions = ["mine"];
  state.chats = ["first"];
  state.compact = true;
  state.mounts = { work: 0, chats: 0 };
  state.workActive = [];
  resetRenderCounts();
  useNavigationStore.setState({
    scopes: { home: "mine", chats: "mine", work: "mine" },
    workChip: "all",
    chatsChip: "all",
    lastList: "work",
  });
});

describe("retained list switching", () => {
  it("keeps both lists mounted and renders no hidden body while Hosts publish", () => {
    const view = render(<Lists section="work" active />);
    view.rerender(<Lists section="chats" active />);
    expect(state.mounts).toEqual({ work: 1, chats: 1 });
    const sequence: ListSection[] = ["work", "chats", "work", "chats", "work", "chats"];
    for (const [index, section] of sequence.entries()) {
      view.rerender(<Lists section={section} active />);
      resetRenderCounts();
      publish({ sessions: [`session-${index}`], chats: [`chat-${index}`] });
      const hidden = section === "work" ? "chats" : "work";
      expect(state.bodyRenders[hidden]).toBe(0);
      expect(state.bodyRenders[section]).toBe(1);
    }
    expect(state.mounts).toEqual({ work: 1, chats: 1 });
  });

  it("renders no list body while the whole panel is hidden behind another tab", () => {
    const view = render(<Lists section="work" active />);
    view.rerender(<Lists section="chats" active />);
    view.rerender(<Lists section="chats" active={false} />);
    resetRenderCounts();
    publish({ sessions: ["mine", "new"], chats: ["first", "new"] });
    publish({ sessions: ["mine", "newer"], chats: ["first", "newer"] });
    expect(state.bodyRenders).toEqual({ work: 0, chats: 0 });
    expect(rows("chat-row")).toEqual(["first"]);
  });

  it("shows the latest rows in the first render after a hidden list returns", () => {
    const view = render(<Lists section="work" active />);
    view.rerender(<Lists section="chats" active />);
    publish({ sessions: ["mine", "new"] });
    expect(rows("work-row")).toEqual(["mine"]);
    resetRenderCounts();
    view.rerender(<Lists section="work" active />);
    expect(state.bodyRenders.work).toBe(1);
    expect(rows("work-row")).toEqual(["mine", "new"]);
  });

  it("does not mount a remembered list until the panel shows it", () => {
    const view = render(<Lists section="work" active={false} />);
    expect(state.mounts).toEqual({ work: 0, chats: 0 });
    expect(screen.queryByTestId("work")).toBeNull();
    view.rerender(<Lists section="work" active />);
    expect(state.mounts).toEqual({ work: 1, chats: 0 });
    expect(rows("work-row")).toEqual(["mine"]);
  });

  it("keeps the same behavior on desktop", () => {
    state.compact = false;
    const view = render(<Lists section="chats" active />);
    view.rerender(<Lists section="work" active />);
    view.rerender(<Lists section="chats" active />);
    expect(state.mounts).toEqual({ work: 1, chats: 1 });
    expect(rows("chat-row")).toEqual(["first"]);
    expect(rows("work-row")).toEqual(["mine"]);
  });
});

function unmountWhenFinished(root: Root) {
  const unmount = () => root.unmount();
  onTestFinished(() => act(unmount));
}

describe("phone Work tab", () => {
  it("keeps the Work list's props unchanged in the tab press's commit", async () => {
    const root = createRoot(document.createElement("div"));
    unmountWhenFinished(root);
    const tab = (shown: boolean) => (
      <RetainedPanelActivity active={shown}>
        <PhoneListTab section="work" />
      </RetainedPanelActivity>
    );
    act(() => root.render(tab(false)));
    state.workActive = [];
    // The press is discrete and committed synchronously, outside act, as on the device.
    const environment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean };
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      flushSync(() => root.render(tab(true)));
      expect(state.workActive.every((active) => active === false)).toBe(true);
      await vi.waitFor(() => expect(state.workActive.at(-1)).toBe(true));
    } finally {
      environment.IS_REACT_ACT_ENVIRONMENT = true;
    }
  });
});

describe("list preferences across switches", () => {
  it("keeps Chats' scope, chip and open search", () => {
    useNavigationStore.setState({
      scopes: { home: "mine", chats: "others", work: "mine" },
      chatsChip: "unread",
      lastList: "chats",
    });
    const view = render(<Lists section="chats" active />);
    fireEvent.click(screen.getByText("Search"));
    fireEvent.change(screen.getByLabelText("Chat search"), { target: { value: "project" } });
    view.rerender(<Lists section="work" active />);
    view.rerender(<Lists section="chats" active />);
    expect(screen.getByTestId("chats-preferences").textContent).toBe("others:unread:chats");
    expect((screen.getByLabelText("Chat search") as HTMLInputElement).value).toBe("project");
  });

  it("keeps Work's scope and chip", () => {
    useNavigationStore.setState({
      scopes: { home: "mine", chats: "mine", work: "others" },
      workChip: "running",
      lastList: "work",
    });
    const view = render(<Lists section="work" active />);
    view.rerender(<Lists section="work" active={false} />);
    view.rerender(<Lists section="work" active />);
    expect(screen.getByTestId("work-preferences").textContent).toBe("others:running:work");
  });
});
