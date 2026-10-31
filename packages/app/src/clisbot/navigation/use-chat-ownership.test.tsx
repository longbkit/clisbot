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
  // Another reader sees a creatorless chat someone else took part in as theirs.
  expect(view.result.current.chatOwnership(chat)).toBe("others");
  context.kinds = new Map([["host", "direct"]]);
  view.rerender();
  expect(view.result.current.chatOwnership(chat)).toBe("mine");
  context.kinds = new Map();
  view.rerender();
  expect(view.result.current.chatOwnership(chat)).toBe("unknown");
  view.unmount();
});

/** A chat whose participant list counts its reads: reading it is the selector's per-chat work. */
function countedChat(id: string, agentId: string) {
  const reads = { count: 0 };
  const participants = [{ botId: "bot", agentId }];
  const chat = {
    id,
    serverId: "host",
    get participants() {
      reads.count += 1;
      return participants;
    },
  } as unknown as HostTagged<ChatPayload>;
  return { chat, reads };
}

it("derives a chat's participation once per change, however many consumers read it", () => {
  context.accounts = [{ origin: "https://hub", id: "me" }];
  context.kinds = new Map([["host", "hub"]]);
  const own = { kind: "user" as const, id: "me", hubOrigin: "https://hub" };
  const { chat, reads } = countedChat("shared-chat", "member");
  const chats = [chat];
  const member: SessionAuthorship = { lastMessageBy: own };
  const other: SessionAuthorship = {};
  act(() => state.setState({ sessions: { host: { agents: new Map([["member", member]]) } } }));
  // Home's pin tags and the Chats pane.
  const pins = renderHook(() => useChatOwnership(chats));
  const list = renderHook(() => useChatOwnership(chats));
  reads.count = 0;
  // A commit that leaves the Host's agents alone: nothing to derive.
  act(() => state.setState({ sessions: { ...state.getState().sessions } }));
  expect(reads.count).toBe(0);
  // Another agent on the same Host moves: the chat's participant is the same object.
  act(() =>
    state.setState({
      sessions: {
        host: {
          agents: new Map([
            ["member", member],
            ["other", other],
          ]),
        },
      },
    }),
  );
  expect(reads.count).toBe(1);
  expect(pins.result.current.chatOwnership(chat)).toBe("mine");
  expect(list.result.current.chatOwnership(chat)).toBe("mine");
  pins.unmount();
  list.unmount();
});

it("holds a hidden consumer's evidence and catches up when it is shown", () => {
  context.accounts = [{ origin: "https://hub", id: "me" }];
  context.kinds = new Map([["host", "hub"]]);
  const own = { kind: "user" as const, id: "me", hubOrigin: "https://hub" };
  const chat = {
    id: "held-chat",
    serverId: "host",
    participants: [{ botId: "bot", agentId: "child" }],
  } as HostTagged<ChatPayload>;
  const chats = [chat];
  const set = (source: SessionAuthorship) =>
    act(() => state.setState({ sessions: { host: { agents: new Map([["child", source]]) } } }));
  set({});
  const render = vi.fn((active: boolean) => useChatOwnership(chats, active));
  const view = renderHook(({ active }) => render(active), { initialProps: { active: false } });
  const count = render.mock.calls.length;
  set({ lastMessageBy: own });
  expect(render).toHaveBeenCalledTimes(count);
  expect(view.result.current.chatOwnership(chat)).toBe("unknown");
  view.rerender({ active: true });
  expect(view.result.current.chatOwnership(chat)).toBe("mine");
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
