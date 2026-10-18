import { afterEach, expect, test, vi } from "vitest";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
const mocks = vi.hoisted(() => ({
  host: null as unknown,
  session: {
    agents: new Map([["a", {}]]),
    pendingPermissions: new Map(),
    active: false,
    serverInfo: undefined as { features: { hostInputQueue?: boolean } } | undefined,
  },
  changed: () => {},
  send: vi.fn(),
}));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getSnapshot: () => mocks.host,
    subscribe: (_: string, listener: () => void) => {
      mocks.changed = listener;
      return () => {};
    },
  }),
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: {
    getState: () => ({ sessions: { host: mocks.session } }),
    subscribe: () => () => {},
  },
  selectAgentTurnPresentation: () => ({ isActive: mocks.session.active }),
}));
vi.mock("../send-chat-input", () => ({
  sendChatInput: (input: { beforeSend(): void }) => {
    input.beforeSend();
    return mocks.send(input);
  },
}));
import { ClientChatQueueRuntime } from "./runtime";
import { getClientChatQueue, setChatQueuePrincipal } from "./registry";
const flush = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve();
};
afterEach(() => {
  mocks.send.mockReset();
  mocks.session.active = false;
  mocks.session.serverInfo = undefined;
  mocks.session.pendingPermissions.clear();
});
function fixture(kind: "direct" | "group" = "direct", discussionActive?: boolean) {
  let chat = {
    id: "chat",
    kind,
    participants: [{ botId: "bot", agentId: "a" }],
    rules: {},
    discussionActive,
  } as ChatPayload;
  const feed = { update: (_event: unknown) => {} };
  const client = {
    listChats: vi.fn(async () => ({ chats: [chat] })),
    fetchChatTranscript: vi.fn(async () => ({
      lines: [] as Array<{ sender: { kind: string }; inReplyTo: string }>,
    })),
    observeEvents: () => ({
      subscribe: (handlers: typeof feed) => {
        feed.update = handlers.update;
      },
      release: async () => {},
    }),
  };
  const host = {
    client,
    connectionStatus: "online",
    connectionEpoch: 1,
    agentDirectoryStatus: "ready",
  };
  mocks.host = host;
  const runtime = new ClientChatQueueRuntime("host", "chat");
  runtime.setEnabled(true);
  return {
    runtime,
    client,
    host,
    update: (next: ChatPayload) => {
      chat = next;
      feed.update({ type: "chat.updated", payload: { chat } });
    },
    chat,
  };
}
test("old DM busy→idle sends Chat-scoped ID once, retained local items stay owned through upgrade/client replacement", async () => {
  const f = fixture();
  mocks.session.serverInfo = { features: { hostInputQueue: false } };
  mocks.session.active = true;
  let ack!: (value: { targets: string[] }) => void;
  mocks.send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        ack = resolve;
      }),
  );
  const item = f.runtime.queue.local.enqueue("Owner Cmd+Enter", []).queued!;
  await flush();
  expect(mocks.send).not.toHaveBeenCalled();
  mocks.session.active = false;
  mocks.changed();
  await flush();
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.send.mock.calls[0][0]).toMatchObject({ messageId: item.id, chat: { id: "chat" } });
  f.host.connectionStatus = "offline";
  mocks.session.serverInfo = undefined;
  mocks.changed();
  await flush();
  f.host.connectionStatus = "online";
  f.host.connectionEpoch++;
  mocks.session.serverInfo = { features: { hostInputQueue: true } };
  f.host.client = { ...f.client };
  mocks.changed();
  await flush();
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(f.runtime.queue.snapshot()[0].state).toBe("sending");
  ack({ targets: ["bot"] });
  await flush();
  expect(f.runtime.queue.snapshot()).toHaveLength(0);
  f.runtime.setEnabled(false);
});
test("feature-off capable group waits discussion completion; old group retains input until deliberate Chat Send", async () => {
  const f = fixture("group", true);
  mocks.send.mockResolvedValue({ targets: [] });
  f.runtime.queue.local.enqueue("group queued", []);
  await flush();
  expect(mocks.send).not.toHaveBeenCalled();
  f.update({ ...f.chat, discussionActive: false });
  await flush();
  expect(mocks.send).toHaveBeenCalledTimes(1);
  f.runtime.setEnabled(false);
  mocks.send.mockClear();
  const old = fixture("group");
  old.runtime.queue.local.enqueue("not safe to deliver", []);
  await flush();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(old.runtime.queue.snapshot()).toHaveLength(1);
  expect(old.runtime.queue.manualDelivery).toBe(true);
  await old.runtime.queue.dispatch(old.runtime.queue.snapshot()[0].id, "send");
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.send.mock.calls[0][0].payload.activeTurnBehavior).toBeUndefined();
  old.runtime.setEnabled(false);
});
test("principal loss or permission does not dispatch accepted input; reconnect unknown remains held", async () => {
  const f = fixture();
  mocks.session.pendingPermissions.set("permission", { agentId: "a" });
  f.runtime.queue.local.enqueue("retained", []);
  await flush();
  expect(mocks.send).not.toHaveBeenCalled();
  f.runtime.setEnabled(false);
  mocks.session.pendingPermissions.clear();
  mocks.changed();
  await flush();
  expect(mocks.send).not.toHaveBeenCalled();
  f.host.agentDirectoryStatus = "initial_loading";
  f.runtime.setEnabled(true);
  await flush();
  expect(mocks.send).not.toHaveBeenCalled();
  f.runtime.setEnabled(false);
});

test("registry retains original Chat owner across participant replacement, scopes account and Host, and never migrates rows", async () => {
  mocks.host = null;
  const a = getClientChatQueue("account-a", "host", "chat");
  const item = a.local.enqueue("intent", []).queued!;
  expect(getClientChatQueue("account-a", "host", "chat")).toBe(a);
  expect(getClientChatQueue("account-b", "host", "chat").snapshot()).toEqual([]);
  expect(getClientChatQueue("account-a", "host-b", "chat").snapshot()).toEqual([]);
  setChatQueuePrincipal("account-b");
  await flush();
  expect(a.local.read(item.id)).toBe(item);
  setChatQueuePrincipal("account-a");
  await flush();
  expect(a.local.read(item.id)).toBe(item);
  expect(mocks.send).not.toHaveBeenCalled();
  a.remove(item.id);
  setChatQueuePrincipal(null);
});

test("reconnect reconciles a missed reply by original messageId before draining the next local item", async () => {
  const f = fixture();
  mocks.send.mockResolvedValue({ targets: ["bot"] });
  const first = f.runtime.queue.local.enqueue("first", []).queued!;
  const second = f.runtime.queue.local.enqueue("second", []).queued!;
  await flush();
  expect(mocks.send).toHaveBeenCalledTimes(1);
  f.host.connectionStatus = "offline";
  mocks.changed();
  await flush();
  f.host.client = {
    ...f.client,
    fetchChatTranscript: vi.fn(async () => ({
      lines: [{ sender: { kind: "bot" }, inReplyTo: first.id }],
    })),
  };
  f.host.connectionStatus = "online";
  f.host.connectionEpoch++;
  mocks.changed();
  await flush();
  expect(mocks.send).toHaveBeenCalledTimes(2);
  expect(mocks.send.mock.calls[1][0].messageId).toBe(second.id);
  expect(mocks.send.mock.calls[0][0].messageId).toBe(first.id);
  f.runtime.setEnabled(false);
});

test("a reconnected matching group reply is not discussion completion; next item waits authoritative idle", async () => {
  const f = fixture("group", false);
  mocks.send.mockResolvedValue({ targets: ["bot"] });
  const first = f.runtime.queue.local.enqueue("A", []).queued!;
  const second = f.runtime.queue.local.enqueue("B", []).queued!;
  await flush();
  expect(mocks.send).toHaveBeenCalledTimes(1);
  f.host.connectionStatus = "offline";
  mocks.changed();
  await flush();
  f.update({ ...f.chat, discussionActive: true });
  f.host.client = {
    ...f.client,
    fetchChatTranscript: vi.fn(async () => ({
      lines: [{ sender: { kind: "bot" }, inReplyTo: first.id }],
    })),
  };
  f.host.connectionStatus = "online";
  f.host.connectionEpoch++;
  mocks.changed();
  await flush();
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(f.runtime.queue.snapshot().map((item) => item.id)).toEqual([second.id]);
  f.update({ ...f.chat, discussionActive: false });
  await flush();
  expect(mocks.send).toHaveBeenCalledTimes(2);
  expect(mocks.send.mock.calls[1][0].messageId).toBe(second.id);
  f.runtime.setEnabled(false);
});
