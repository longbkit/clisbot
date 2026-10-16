// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({
  path: "/chat",
  homeV2: true,
  native: false,
  panel: { target: "agent-list", revision: 1 },
}));
const navigation = vi.hoisted(() => ({ getCurrentRoute: vi.fn() }));
vi.mock("@/constants/platform", () => ({
  get isNative() {
    return route.native;
  },
}));
vi.mock("@/stores/panel-store", () => ({
  usePanelStore: { getState: () => ({ mobilePanel: route.panel }) },
}));
vi.mock("expo-router", () => ({
  usePathname: () => route.path,
  useNavigationContainerRef: () => navigation,
}));
vi.mock("./feature", () => ({
  get HOME_V2_ENABLED() {
    return route.homeV2;
  },
}));
const rememberChatReturn = vi.hoisted(() => vi.fn());
vi.mock("./mobile-navigation", () => ({ rememberChatReturn }));
import {
  createChatListPresentation,
  useChatListNavigation,
  useChatListScreenListeners,
} from "./use-chat-list-navigation";

beforeEach(() => {
  route.path = "/chat";
  route.homeV2 = true;
  route.native = false;
  route.panel = { target: "agent-list", revision: 1 };
  vi.clearAllMocks();
});
afterEach(cleanup);

it.each([
  "/h/host-a/workspace/workspace-a",
  "/h/host-a/chat/direct-chat",
  "/h/host-a/chat/group-chat",
])("keeps the outgoing list until the destination commits: %s", (destination) => {
  const close = vi.fn();
  const view = renderHook(() => useChatListNavigation(close));
  act(() => view.result.current());
  expect(rememberChatReturn).toHaveBeenCalledWith("/chat");
  expect(close).not.toHaveBeenCalled();
  // Merely preparing a tab or receiving catalog updates does not close the outgoing page.
  view.rerender();
  expect(close).not.toHaveBeenCalled();
  route.path = destination;
  view.rerender();
  expect(close).toHaveBeenCalledTimes(1);
});

it("closes an overlay on a current workspace even when another agent keeps the same pathname", () => {
  route.path = "/h/host-a/workspace/workspace-a";
  const close = vi.fn();
  const view = renderHook(() => useChatListNavigation(close));
  act(() => view.result.current());
  expect(close).toHaveBeenCalledTimes(1);
});

it("has no late readiness completion after Back or a newer navigation", () => {
  const close = vi.fn();
  const view = renderHook(() => useChatListNavigation(close));
  act(() => view.result.current());
  route.path = "/open-project"; // Back/newer intent wins before the detail commits.
  view.rerender();
  expect(close).toHaveBeenCalledTimes(1);
  route.path = "/chat";
  view.rerender();
  // A late directory response only rerenders; it cannot complete the canceled navigation.
  view.rerender();
  expect(close).toHaveBeenCalledTimes(1);
  act(() => view.result.current());
  route.path = "/h/host-b/workspace/newer-workspace";
  view.rerender();
  expect(close).toHaveBeenCalledTimes(2);
  view.unmount();
});

it("preserves the legacy panel-close behavior", () => {
  route.homeV2 = false;
  const close = vi.fn();
  const view = renderHook(() => useChatListNavigation(close));
  act(() => view.result.current());
  expect(close).toHaveBeenCalledTimes(1);
  expect(rememberChatReturn).not.toHaveBeenCalled();
});

const panel = { target: "agent-list" as const, revision: 1 };
const destination = (id = "workspace-a") => `/h/host-a/workspace/${id}`;
const leaf = (id = "workspace-a") => ({
  key: `leaf-${id}`,
  name: "workspace/[workspaceId]/index",
  params: { serverId: "host-a", workspaceId: id },
});
const event = (id = "workspace-a") => ({ target: leaf(id).key, data: { closing: false } });

it("waits for the actual requested native leaf, independently from JS path commit", () => {
  const owner = createChatListPresentation(),
    close = vi.fn();
  owner.begin(panel, destination(), close);
  expect(close).not.toHaveBeenCalled();
  owner.transitionStart(event(), leaf());
  owner.transitionEnd(event(), leaf(), panel);
  expect(close).toHaveBeenCalledTimes(1);
});
it.each(["parent", "closing", "wrong-leaf", "same-key-wrong-identity", "new-panel", "canceled"])(
  "rejects stale/unrelated native presentation: %s",
  (variant) => {
    const owner = createChatListPresentation(),
      close = vi.fn();
    const cancel = owner.begin(panel, destination(), close);
    owner.transitionStart(event(), leaf());
    if (variant === "canceled") cancel();
    let end = event();
    if (variant === "parent") end = { ...event(), target: "host-parent" };
    if (variant === "closing") end = { ...event(), data: { closing: true } };
    let current = leaf();
    if (variant === "wrong-leaf") current = leaf("workspace-b");
    if (variant === "same-key-wrong-identity")
      current = { ...leaf("workspace-b"), key: leaf().key };
    owner.transitionEnd(end, current, variant === "new-panel" ? { ...panel, revision: 3 } : panel);
    expect(close).not.toHaveBeenCalled();
  },
);
it("binds B at admission while Expo still reports committed A before its passive dispatch", () => {
  route.native = true;
  const close = vi.fn();
  const view = renderHook(() => ({
    press: useChatListNavigation(close),
    listeners: useChatListScreenListeners(),
  }));
  act(() => view.result.current.press(destination()));
  navigation.getCurrentRoute.mockReturnValue(leaf());
  act(() => view.result.current.listeners.transitionStart(event()));
  route.path = destination();
  view.rerender();
  // B is queued, but React's layout still observes old committed A.
  act(() => view.result.current.press(destination("workspace-b")));
  view.rerender();
  act(() => view.result.current.listeners.transitionEnd(event()));
  expect(close).not.toHaveBeenCalled();
  navigation.getCurrentRoute.mockReturnValue(leaf("workspace-b"));
  route.path = destination("workspace-b");
  view.rerender();
  act(() => {
    view.result.current.listeners.transitionStart(event("workspace-b"));
    view.result.current.listeners.transitionEnd(event("workspace-b"));
  });
  expect(close).toHaveBeenCalledTimes(1);
});
it("a stale panel generation cannot turn a current-workspace overlay into pending navigation", () => {
  route.native = true;
  const close = vi.fn();
  const view = renderHook(() => useChatListNavigation(close));
  act(() => view.result.current(destination()));
  route.panel = { target: "agent-list", revision: 3 };
  route.path = destination();
  view.rerender();
  act(() => view.result.current(destination()));
  expect(close).toHaveBeenCalledTimes(1);
});
it("Back cancels the pending close before an old leaf appears", () => {
  route.native = true;
  const close = vi.fn();
  const view = renderHook(() => ({
    press: useChatListNavigation(close),
    listeners: useChatListScreenListeners(),
  }));
  act(() => view.result.current.press(destination()));
  navigation.getCurrentRoute.mockReturnValue(leaf());
  route.path = destination();
  view.rerender();
  act(() => view.result.current.listeners.transitionStart(event()));
  route.path = "/chat";
  view.rerender();
  act(() => view.result.current.listeners.transitionEnd(event()));
  expect(close).not.toHaveBeenCalled();
});
it.each(["direct-chat", "group-chat"])(
  "uses the same native presentation for Bot conversation %s",
  (id) => {
    const owner = createChatListPresentation(),
      close = vi.fn();
    const chat = { key: id, name: "chat/[chatId]", params: { serverId: "host-a", chatId: id } };
    const appear = { target: id, data: { closing: false } };
    owner.begin(panel, `/h/host-a/chat/${id}`, close);
    owner.transitionStart(appear, chat);
    owner.transitionEnd(appear, chat, panel);
    expect(close).toHaveBeenCalledTimes(1);
  },
);
it("native current-workspace overlays close without requiring another appearance", () => {
  route.native = true;
  route.path = destination();
  const close = vi.fn(),
    view = renderHook(() => useChatListNavigation(close));
  act(() => view.result.current(destination()));
  expect(close).toHaveBeenCalledTimes(1);
});

it("keeps row admission identity across path commits while reading the latest committed overlay path", () => {
  const close = vi.fn();
  const view = renderHook(() => useChatListNavigation(close));
  const admit = view.result.current;
  route.path = "/h/host-a/workspace";
  view.rerender();
  expect(view.result.current).toBe(admit);
  route.path = destination();
  view.rerender();
  expect(view.result.current).toBe(admit);
  close.mockClear(); // The preceding Chat departure already closed on its committed path.
  act(() => admit(destination()));
  expect(close).toHaveBeenCalledOnce();
  route.path = "/chat";
  view.rerender();
  expect(view.result.current).toBe(admit);
  act(() => admit(destination()));
  expect(close).toHaveBeenCalledOnce();
});
it("keeps the newest peer-tab intent when an earlier Home appearance arrives", () => {
  const owner = createChatListPresentation(),
    close = vi.fn();
  const home = { key: "home", name: "open-project" };
  const inbox = { key: "inbox", name: "sessions" };
  const homeEvent = { target: home.key, data: { closing: false } };
  const inboxEvent = { target: inbox.key, data: { closing: false } };
  owner.begin(panel, "/open-project", close);
  owner.transitionStart(homeEvent, home);
  owner.begin(panel, "/sessions", close);
  expect(owner.getPendingDestination()).toBe("/sessions");
  owner.transitionEnd(homeEvent, home, panel);
  expect(close).not.toHaveBeenCalled();
  owner.transitionStart(inboxEvent, inbox);
  owner.transitionEnd(inboxEvent, inbox, panel);
  expect(close).toHaveBeenCalledOnce();
});
it("cancels a peer departure before late Home appearance without hiding Chat", () => {
  const owner = createChatListPresentation(),
    close = vi.fn();
  const home = { key: "home", name: "open-project" };
  const appear = { target: home.key, data: { closing: false } };
  owner.begin(panel, "/open-project", close);
  owner.transitionStart(appear, home);
  owner.returnToList();
  owner.transitionEnd(appear, home, panel);
  expect(close).not.toHaveBeenCalled();
  owner.didReturnToList();
  expect(owner.getPendingDestination()).toBeNull();
});
