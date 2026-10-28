// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { create } from "zustand";
import type { SessionAuthorship } from "@clisbot/protocol/session-authorship";
import type { ChatPayload } from "@/clisbot/bots/data/contracts";
import type { HostTagged } from "@/clisbot/bots/data/aggregate";

const state = create<{ sessions: Record<string, { agents: Map<string, SessionAuthorship> }> }>(
  () => ({ sessions: {} }),
);
vi.mock("@/stores/session-store", () => ({ useSessionStore: state }));
const context = vi.hoisted(() => ({
  accounts: [{ origin: "https://hub", id: "me" }],
  kinds: new Map<string, "hub" | "direct">([["host", "hub"]]),
}));
vi.mock("./reader", () => ({ useReaderAccounts: () => context.accounts }));
vi.mock("./use-ownership-hosts", () => ({ useOwnershipHosts: () => context.kinds }));
const { useChatOwnership } = await import("./use-chat-ownership");

it("subscribes to identity changes only, then reclassifies on reader or Host changes", () => {
  const own = { kind: "user" as const, id: "me", hubOrigin: "https://hub" };
  const chat = {
    id: "chat",
    serverId: "host",
    participants: [{ botId: "bot", agentId: "child" }],
  } as HostTagged<ChatPayload>;
  const chats = [chat];
  const set = (source: SessionAuthorship) =>
    act(() => state.setState({ sessions: { host: { agents: new Map([["child", source]]) } } }));
  set({});
  const render = vi.fn(() => useChatOwnership(chats));
  const view = renderHook(render);
  expect(view.result.current.chatOwnership(chat)).toBe("unknown");
  const before = view.result.current;
  const count = render.mock.calls.length;
  set({ lastInteractionBy: own });
  expect(view.result.current).toBe(before);
  expect(render).toHaveBeenCalledTimes(count);
  set({ lastMessageBy: own });
  expect(view.result.current.chatOwnership(chat)).toBe("mine");
  const matched = view.result.current;
  set({ lastMessageBy: { ...own, displayName: "Renamed", avatarUrl: "https://avatar" } });
  expect(view.result.current).toBe(matched);
  context.accounts = [{ origin: "https://hub", id: "other" }];
  view.rerender();
  expect(view.result.current.chatOwnership(chat)).toBe("unknown");
  context.kinds = new Map([["host", "direct"]]);
  view.rerender();
  expect(view.result.current.chatOwnership(chat)).toBe("mine");
  context.kinds = new Map();
  view.rerender();
  expect(view.result.current.chatOwnership(chat)).toBe("unknown");
  view.unmount();
});

it("updates an authored chat when verified participation arrives, without profile rerenders", () => {
  context.accounts = [{ origin: "https://hub", id: "me" }];
  context.kinds = new Map([["host", "hub"]]);
  const own = { kind: "user" as const, id: "me", hubOrigin: "https://hub" };
  const other = { ...own, id: "creator" };
  const chat = {
    id: "authored-chat",
    serverId: "host",
    record: { createdBy: other },
    participants: [{ botId: "bot", agentId: "child" }],
  } as HostTagged<ChatPayload>;
  const chats = [chat];
  const set = (source: SessionAuthorship) =>
    act(() => state.setState({ sessions: { host: { agents: new Map([["child", source]]) } } }));
  set({ createdBy: other });
  const view = renderHook(() => useChatOwnership(chats));
  expect(view.result.current.chatOwnership(chat)).toBe("others");
  set({ createdBy: other, participantActors: [own] });
  expect(view.result.current.chatOwnership(chat)).toBe("mine");
  const matched = view.result.current;
  set({ createdBy: other, participantActors: [{ ...own, displayName: "Renamed" }] });
  expect(view.result.current).toBe(matched);
  set({ createdBy: other, lastInteractionBy: own });
  expect(view.result.current.chatOwnership(chat)).toBe("others");
  view.unmount();
});
