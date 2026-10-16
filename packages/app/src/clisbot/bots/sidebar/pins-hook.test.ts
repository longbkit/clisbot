// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
const principal = vi.hoisted(() => ({ scope: "owner" }));
vi.mock("../data/resource-principal-scope", () => ({
  useResourcePrincipalScope: () => principal.scope,
}));
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
beforeEach(() => {
  principal.scope = "owner";
  useResourcePinsStore.setState({ scopes: {} });
});
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

it("offline Unpin removes already-proved legacy aliases without keeping private metadata", async () => {
  useResourcePinsStore.setState({ scopes: { owner: [chatPin, botPin], stranger: [chatPin] } });
  const hook = renderHook(({ chats }) => useResourcePins(chats), {
    initialProps: { chats: [chat] },
  });
  hook.rerender({ chats: [] });
  expect(hook.result.current.pins).toEqual([botPin]);
  await act(async () => hook.result.current.toggle(botPin));
  expect(useResourcePinsStore.getState().scopes.owner).toEqual([]);
  principal.scope = "stranger";
  hook.rerender({ chats: [] });
  expect(hook.result.current.pins).toEqual([chatPin]);
  expect(hook.result.current.isPinned(botPin)).toBe(false);
  hook.unmount();
});
