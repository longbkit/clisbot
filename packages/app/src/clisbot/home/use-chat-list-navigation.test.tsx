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
const armSampling = vi.hoisted(() => vi.fn());
vi.mock("@/performance/native-trace", () => ({
  traceInstant: vi.fn(),
  startArmedHermesSampling: armSampling,
}));
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
import { nativePresentation } from "./chat-list-presentation";

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
  owner.transitionStart(event(), leaf(), panel);
  owner.transitionEnd(event(), leaf(), panel);
  expect(close).toHaveBeenCalledTimes(1);
});
it.each(["parent", "closing", "wrong-leaf", "same-key-wrong-identity", "new-panel", "canceled"])(
  "rejects stale/unrelated native presentation: %s",
  (variant) => {
    const owner = createChatListPresentation(),
      close = vi.fn();
    const cancel = owner.begin(panel, destination(), close);
    owner.transitionStart(event(), leaf(), panel);
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
    owner.transitionStart(appear, chat, panel);
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
  owner.transitionStart(homeEvent, home, panel);
  owner.begin(panel, "/sessions", close);
  expect(owner.getPendingDestination()).toBe("/sessions");
  owner.transitionEnd(homeEvent, home, panel);
  expect(close).not.toHaveBeenCalled();
  owner.transitionStart(inboxEvent, inbox, panel);
  owner.transitionEnd(inboxEvent, inbox, panel);
  expect(close).toHaveBeenCalledOnce();
});
it("cancels a peer departure before late Home appearance without hiding Chat", () => {
  const owner = createChatListPresentation(),
    close = vi.fn();
  const home = { key: "home", name: "open-project" };
  const appear = { target: home.key, data: { closing: false } };
  owner.begin(panel, "/open-project", close);
  owner.transitionStart(appear, home, panel);
  owner.returnToList();
  owner.transitionEnd(appear, home, panel);
  expect(close).not.toHaveBeenCalled();
  owner.didReturnToList();
  expect(owner.getPendingDestination()).toBeNull();
});

it.each(["commit-first", "appear-first"])(
  "joins actual native visibility with the owning leaf commit: %s",
  (order) => {
    const owner = createChatListPresentation(),
      close = vi.fn();
    owner.begin(panel, destination(), close);
    if (order === "commit-first") owner.commitLeaf(leaf(), panel);
    else owner.transitionEnd(event(), leaf(), panel);
    expect(close).not.toHaveBeenCalled();
    if (order === "commit-first") owner.transitionEnd(event(), leaf(), panel);
    else owner.commitLeaf(leaf(), panel);
    expect(close).toHaveBeenCalledOnce();
  },
);
it("completes re-entry when the same native view commits B without another appearance", () => {
  const owner = createChatListPresentation(),
    closeA = vi.fn(),
    closeB = vi.fn();
  const a = leaf(),
    b = { ...leaf("workspace-b"), key: a.key };
  owner.commitLeaf(a, panel);
  owner.begin(panel, destination(), closeA);
  owner.transitionEnd(event(), a, panel);
  owner.returnToList();
  const nextPanel = { ...panel, revision: 3 };
  owner.begin(nextPanel, destination("workspace-b"), closeB);
  // Expo can still publish A while B dispatch is queued; it cannot certify B.
  owner.commitLeaf(a, nextPanel);
  expect(closeB).not.toHaveBeenCalled();
  owner.commitLeaf(b, nextPanel);
  expect(closeB).toHaveBeenCalledOnce();
});
it.each(["new-native-key", "disappeared", "parent-only", "back", "new-panel", "newer-C"])(
  "never substitutes JS commit for an absent/wrong native destination: %s",
  (variant) => {
    const owner = createChatListPresentation(),
      close = vi.fn();
    const a = leaf(),
      b = { ...leaf("workspace-b"), key: a.key };
    owner.commitLeaf(a, panel);
    if (variant === "parent-only")
      owner.transitionEnd({ target: "host-parent", data: { closing: false } }, a, panel);
    else owner.transitionEnd(event(), a, panel);
    if (variant === "disappeared") {
      owner.transitionStart({ ...event(), data: { closing: true } }, a, panel);
      owner.transitionEnd({ ...event(), data: { closing: true } }, a, panel);
    }
    owner.begin(panel, destination("workspace-b"), close);
    if (variant === "back") owner.returnToList();
    if (variant === "newer-C") owner.begin(panel, destination("workspace-c"), close);
    owner.commitLeaf(
      variant === "new-native-key" ? leaf("workspace-b") : b,
      variant === "new-panel" ? { ...panel, revision: 3 } : panel,
    );
    expect(close).not.toHaveBeenCalled();
  },
);
it("drops a hidden owning leaf and ignores late old appearance until the new focused leaf commits", () => {
  const owner = createChatListPresentation(),
    close = vi.fn();
  const a = leaf(),
    b = { ...leaf("workspace-b"), key: a.key };
  const leave = owner.commitLeaf(a, panel);
  owner.transitionEnd(event(), a, panel);
  leave();
  owner.begin(panel, destination("workspace-b"), close);
  owner.transitionEnd(event(), a, panel);
  expect(close).not.toHaveBeenCalled();
  owner.commitLeaf(b, panel);
  expect(close).toHaveBeenCalledOnce();
});
it.each(["reversal-start", "full-disappearance"])(
  "blocks B while closing and completes only on the native reversal/appearance: %s",
  (variant) => {
    const owner = createChatListPresentation(),
      close = vi.fn();
    const a = leaf(),
      b = { ...leaf("workspace-b"), key: a.key };
    const closing = { ...event(), data: { closing: true } };
    owner.commitLeaf(a, panel);
    owner.transitionEnd(event(), a, panel);
    owner.transitionStart(closing, a, panel);
    owner.begin(panel, destination("workspace-b"), close);
    owner.commitLeaf(b, panel);
    expect(close).not.toHaveBeenCalled();
    if (variant === "full-disappearance") owner.transitionEnd(closing, a, panel);
    owner.transitionStart(event(), b, panel);
    if (variant === "full-disappearance") {
      expect(close).not.toHaveBeenCalled();
      owner.transitionEnd(event(), b, panel);
    }
    // Reversal with no DID_DISAPPEAR need not emit another DID_APPEAR on Android.
    expect(close).toHaveBeenCalledOnce();
  },
);
it("late closing end cannot erase a newer acknowledged appearance", () => {
  const owner = createChatListPresentation(),
    close = vi.fn();
  const a = leaf(),
    b = { ...leaf("workspace-b"), key: a.key };
  const closing = { ...event(), data: { closing: true } };
  owner.commitLeaf(a, panel);
  owner.transitionEnd(event(), a, panel);
  owner.transitionStart(closing, a, panel);
  owner.transitionStart(event(), a, panel);
  owner.transitionEnd(event(), a, panel);
  owner.transitionEnd(closing, a, panel);
  owner.begin(panel, destination("workspace-b"), close);
  owner.commitLeaf(b, panel);
  expect(close).toHaveBeenCalledOnce();
});
it("late opening end cannot certify a native screen in a newer closing phase", () => {
  const owner = createChatListPresentation(),
    close = vi.fn();
  const a = leaf(),
    b = { ...leaf("workspace-b"), key: a.key };
  owner.commitLeaf(a, panel);
  owner.transitionStart(event(), a, panel);
  owner.transitionStart({ ...event(), data: { closing: true } }, a, panel);
  owner.begin(panel, destination("workspace-b"), close);
  owner.transitionEnd(event(), a, panel);
  owner.commitLeaf(b, panel);
  expect(close).not.toHaveBeenCalled();
});
it.each(["peer", "bot"])(
  "stale closing end preserves the newer opening record without an owning leaf: %s",
  (variant) => {
    const owner = createChatListPresentation(),
      close = vi.fn();
    const current =
      variant === "peer"
        ? { key: "home", name: "open-project" }
        : {
            key: "bot-chat",
            name: "chat/[chatId]",
            params: { serverId: "host-a", chatId: "direct-chat" },
          };
    const opening = { target: current.key, data: { closing: false } };
    const closing = { ...opening, data: { closing: true } };
    owner.begin(panel, variant === "peer" ? "/open-project" : "/h/host-a/chat/direct-chat", close);
    owner.transitionStart(closing, current, panel);
    owner.transitionStart(opening, current, panel);
    owner.transitionEnd(closing, current, panel);
    expect(close).not.toHaveBeenCalled();
    owner.transitionEnd(opening, current, panel);
    expect(close).toHaveBeenCalledOnce();
  },
);

it("offers the exact native DM admission to the existing one-shot profile gate before dispatch", () => {
  route.native = true;
  const close = vi.fn();
  const dmDestination = "/h/host-a/chat/direct-chat";
  const view = renderHook(() => useChatListNavigation(close));
  act(() => view.result.current(dmDestination));
  expect(armSampling).toHaveBeenCalledExactlyOnceWith(dmDestination);
  expect(close).not.toHaveBeenCalled();
});
it("does not invoke native sampling for web or destination-less overlay actions", () => {
  const view = renderHook(() => useChatListNavigation(vi.fn()));
  act(() => view.result.current("/h/host-a/chat/direct-chat"));
  route.native = true;
  view.rerender();
  act(() => view.result.current());
  expect(armSampling).not.toHaveBeenCalled();
});

it("mounts the native Back/loading shell before the route dispatch runs in a later task", () => {
  vi.useFakeTimers();
  try {
    route.native = true;
    const go = vi.fn();
    const view = renderHook(() => useChatListNavigation(vi.fn()));
    let owned: boolean | void = false;
    act(() => {
      owned = view.result.current("/h/host-a/chat/direct-chat", go);
    });
    expect(owned).toBe(true);
    expect(go).not.toHaveBeenCalled();
    expect(nativePresentation.getPendingSnapshot()).toMatchObject({
      destination: "/h/host-a/chat/direct-chat",
      returning: false,
    });
    act(() => vi.runAllTimers());
    expect(go).toHaveBeenCalledOnce();
    // The dispatched admission keeps its ordinary appearance/return lifecycle.
    expect(nativePresentation.returnToList()).toBe(true);
    expect(nativePresentation.getPendingSnapshot()?.returning).toBe(true);
  } finally {
    nativePresentation.cancel();
    vi.useRealTimers();
  }
});
it("Back or a newer row before the queued dispatch runs drops the stale route", () => {
  vi.useFakeTimers();
  try {
    route.native = true;
    const view = renderHook(() => useChatListNavigation(vi.fn()));
    const goA = vi.fn();
    act(() => void view.result.current("/h/host-a/chat/a", goA));
    // Nothing left Chat yet: Back removes the admission instead of awaiting a return.
    expect(nativePresentation.returnToList()).toBe(true);
    expect(nativePresentation.getPendingSnapshot()).toBeNull();
    const goB = vi.fn();
    const goC = vi.fn();
    act(() => void view.result.current("/h/host-a/chat/b", goB));
    act(() => void view.result.current("/h/host-a/chat/c", goC));
    act(() => vi.runAllTimers());
    expect(goA).not.toHaveBeenCalled();
    expect(goB).not.toHaveBeenCalled();
    expect(goC).toHaveBeenCalledOnce();
    expect(nativePresentation.getPendingSnapshot()?.destination).toBe("/h/host-a/chat/c");
  } finally {
    nativePresentation.cancel();
    vi.useRealTimers();
  }
});
it("a panel generation change before the queued dispatch drops it", () => {
  vi.useFakeTimers();
  try {
    route.native = true;
    const view = renderHook(() => useChatListNavigation(vi.fn()));
    const go = vi.fn();
    act(() => void view.result.current("/h/host-a/chat/a", go));
    route.panel = { target: "agent-list", revision: 2 };
    act(() => vi.runAllTimers());
    expect(go).not.toHaveBeenCalled();
    expect(nativePresentation.getPendingSnapshot()).toBeNull();
  } finally {
    nativePresentation.cancel();
    vi.useRealTimers();
  }
});
it("leaves dispatch to the caller on web and for non-departing native presses", () => {
  const go = vi.fn();
  const view = renderHook(() => useChatListNavigation(vi.fn()));
  expect(view.result.current("/h/host-a/chat/a", go)).toBe(false);
  route.native = true;
  route.path = "/h/host-a/workspace/w";
  view.rerender();
  expect(view.result.current("/h/host-a/chat/a", go)).toBe(false);
  expect(go).not.toHaveBeenCalled();
});
it("a newer global route committed before the queued dispatch wins over the stale row", () => {
  vi.useFakeTimers();
  try {
    route.native = true;
    const view = renderHook(() => useChatListNavigation(vi.fn()));
    const go = vi.fn();
    act(() => void view.result.current("/h/host-a/chat/a", go));
    route.path = "/settings";
    view.rerender();
    act(() => vi.runAllTimers());
    expect(go).not.toHaveBeenCalled();
    expect(nativePresentation.getPendingSnapshot()).toBeNull();
  } finally {
    nativePresentation.cancel();
    vi.useRealTimers();
  }
});
it("an earlier admission's own late commit does not cancel the newer queued row", () => {
  vi.useFakeTimers();
  try {
    route.native = true;
    const view = renderHook(() => useChatListNavigation(vi.fn()));
    const goA = vi.fn();
    const goB = vi.fn();
    act(() => void view.result.current("/h/host-a/chat/a", goA));
    act(() => vi.runAllTimers());
    expect(goA).toHaveBeenCalledOnce();
    act(() => void view.result.current("/h/host-a/chat/b", goB));
    route.path = "/h/host-a/chat/a";
    view.rerender();
    act(() => vi.runAllTimers());
    expect(goB).toHaveBeenCalledOnce();
    expect(nativePresentation.getPendingSnapshot()?.destination).toBe("/h/host-a/chat/b");
  } finally {
    nativePresentation.cancel();
    vi.useRealTimers();
  }
});
