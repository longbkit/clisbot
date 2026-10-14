// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useSessionStore } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import { useChatLiveHeads } from "./use-chat-live-heads";
import { chatLiveItems } from "./render-model";

afterEach(() => useSessionStore.getState().clearSession("silent-host"));

it("reads the real active head, hands it to the tail, and ignores another agent's tokens", () => {
  const store = useSessionStore.getState();
  store.initializeSession("silent-host", null);
  const participants = [
    { botId: "bot-a", agentId: "agent-a", slug: "a", displayName: "A", addedAt: "2026-10-14" },
  ];
  const item: StreamItem = {
    kind: "assistant_message",
    id: "r",
    messageId: "m",
    turnId: "t",
    timestamp: new Date(3),
    text: "PASS means idle",
  };
  const hook = renderHook(() => useChatLiveHeads("silent-host", participants));
  const initial = hook.result.current;
  act(() => store.setAgentStreamState("silent-host", "other-agent", { head: [item] }));
  expect(hook.result.current).toBe(initial);
  act(() => store.setAgentStreamState("silent-host", "agent-a", { head: [item] }));
  const streaming = hook.result.current.get("bot-a")!;
  expect(streaming.items).toEqual([]);
  expect(chatLiveItems(streaming)).toEqual([item]);
  act(() => store.setAgentStreamState("silent-host", "agent-a", { tail: [item], head: [] }));
  expect(chatLiveItems(hook.result.current.get("bot-a")!)).toEqual([item]);
  hook.unmount();
});
