// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useSessionStore } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import {
  useChatHeaderToolActivities,
  useChatLiveHeads,
  useChatTurnActive,
} from "./use-chat-live-heads";
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

it("re-renders only the streaming bubble's owner on a text chunk, not the route or its header", () => {
  const store = useSessionStore.getState();
  store.initializeSession("silent-host", null);
  const participants = [
    { botId: "bot-a", agentId: "agent-a", slug: "a", displayName: "A", addedAt: "2026-10-14" },
  ];
  const chunk = (text: string): StreamItem => ({
    kind: "assistant_message",
    id: "r",
    messageId: "m",
    turnId: "t",
    timestamp: new Date(3),
    text,
  });
  const runningTool = {
    kind: "tool_call",
    id: "tool-1",
    turnId: "t",
    timestamp: new Date(2),
    payload: {
      source: "agent",
      data: {
        provider: "mock",
        callId: "tool-1",
        name: "shell",
        status: "running",
        detail: { type: "shell", command: "npm test" },
      },
    },
  } as StreamItem;
  act(() => store.setAgentStreamState("silent-host", "agent-a", { tail: [runningTool] }));
  const renders = { bubble: 0, route: 0, header: 0 };
  renderHook(() => {
    renders.bubble += 1;
    return useChatLiveHeads("silent-host", participants);
  });
  renderHook(() => {
    renders.route += 1;
    return useChatTurnActive("silent-host", participants);
  });
  const header = renderHook(() => {
    renders.header += 1;
    return useChatHeaderToolActivities("silent-host", participants, true);
  });
  expect(header.result.current.map((entry) => entry.botId)).toEqual(["bot-a"]);
  act(() => store.setAgentStreamState("silent-host", "agent-a", { head: [chunk("Hel")] }));
  act(() => store.setAgentStreamState("silent-host", "agent-a", { head: [chunk("Hello")] }));
  act(() => store.setAgentStreamState("silent-host", "agent-a", { head: [chunk("Hello there")] }));
  expect(renders).toEqual({ bubble: 4, route: 1, header: 1 });
});
