// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ path: "/chat", homeV2: true }));
vi.mock("expo-router", () => ({ usePathname: () => route.path }));
vi.mock("./feature", () => ({
  get HOME_V2_ENABLED() {
    return route.homeV2;
  },
}));
const rememberChatReturn = vi.hoisted(() => vi.fn());
vi.mock("./mobile-navigation", () => ({ rememberChatReturn }));
import { useChatListNavigation } from "./use-chat-list-navigation";

beforeEach(() => {
  route.path = "/chat";
  route.homeV2 = true;
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
