// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
vi.mock("../data/resource-principal-scope", () => ({ useResourcePrincipalScope: () => "owner" }));
import { useResourcePins, useResourcePinsStore } from "./pins";
import type { PinChat } from "./pin-identity";
const chat: PinChat = {
  serverId: "host",
  id: "dm",
  kind: "direct",
  participants: [{ botId: "bot", agentId: null }],
};
const chatPin = { kind: "chat" as const, serverId: "host", id: "dm" };
const botPin = { kind: "bot" as const, serverId: "host", id: "bot" };
beforeEach(() => useResourcePinsStore.setState({ scopes: {} }));
it("shares pin state and toggle behavior between the DM and sidebar bot surfaces", async () => {
  const sidebar = renderHook(() => useResourcePins([chat]));
  const conversation = renderHook(() => useResourcePins([chat]));
  await act(async () => {
    conversation.result.current.toggle(chatPin);
  });
  expect(sidebar.result.current.isPinned(botPin)).toBe(true);
  expect(sidebar.result.current.pins).toEqual([botPin]);
  await act(async () => {
    sidebar.result.current.toggle(botPin);
  });
  expect(conversation.result.current.isPinned(chatPin)).toBe(false);
  await act(async () => {
    sidebar.result.current.toggle(botPin);
  });
  expect(conversation.result.current.isPinned(chatPin)).toBe(true);
  await act(async () => {
    conversation.result.current.toggle(chatPin);
  });
  expect(sidebar.result.current.pins).toEqual([]);
  sidebar.unmount();
  conversation.unmount();
});
it("resolves hydrated legacy aliases when catalog arrives without discarding persisted intent", async () => {
  useResourcePinsStore.setState({ scopes: { owner: [chatPin, botPin] } });
  const hook = renderHook(({ chats }) => useResourcePins(chats), {
    initialProps: { chats: [] as PinChat[] },
  });
  expect(hook.result.current.pins).toHaveLength(2);
  hook.rerender({ chats: [chat] });
  expect(hook.result.current.pins).toEqual([botPin]);
  expect(hook.result.current.isPinned(chatPin)).toBe(true);
  expect(useResourcePinsStore.getState().scopes.owner).toEqual([chatPin, botPin]);
  await act(async () => {
    hook.result.current.toggle(botPin);
  });
  expect(useResourcePinsStore.getState().scopes.owner).toEqual([]);
  hook.unmount();
});
