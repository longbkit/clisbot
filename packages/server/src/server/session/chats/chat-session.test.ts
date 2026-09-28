import { expect, test, vi } from "vitest";
import { ChatSession } from "./chat-session.js";
import type { ChatService } from "../../chats/chat-service.js";
import type { BotService } from "../../bots/index.js";
import type { SessionOutboundMessage } from "../../messages.js";
import type { StoredBot } from "@getpaseo/protocol/bots/types";
import type { StoredChat } from "../../chats/chat-record.js";

const bot = {
  id: "bot-1",
  projectId: "project-1",
  workspaceId: "workspace-1",
  archivedAt: null,
  launch: { provider: "claude" },
  cwd: "/bot",
} as StoredBot;
const chat = {
  id: "chat-1",
  createdBy: { kind: "user", id: "alice", organizationId: "org" },
  participants: [{ botId: bot.id, agentId: null }],
} as StoredChat;

function harness(actorId: string) {
  let allowed = true;
  let sessionAllowed = true;
  let publisher: (message: SessionOutboundMessage) => void = () => {};
  const messages: SessionOutboundMessage[] = [];
  const service = {
    record: (id: string) => (id === chat.id ? chat : null),
    subscribe: (listener: typeof publisher) => {
      publisher = listener;
      return () => {};
    },
    list: async () => [chat],
    update: vi.fn(async () => chat),
    fetchTranscript: vi.fn(async () => ({
      lines: [],
      hasOlder: false,
      hasNewer: false,
      startSeq: 0,
      endSeq: 0,
    })),
    send: vi.fn(async () => ({ messageId: "m", seq: 1, targets: [bot.id] })),
  } as unknown as ChatService;
  const bots = {
    list: async () => [bot],
    get: async () => bot,
    subscribe: () => () => {},
  } as unknown as BotService;
  const session = new ChatSession(
    service,
    bots,
    {
      isRestricted: () => true,
      allowsProject: () => allowed,
      mayCreateProjectAt: async () => false,
      allowsAgentConfiguration: async () => allowed,
      allowsChatSessionConfiguration: async () => allowed && sessionAllowed,
    },
    () => ({ kind: "user", id: actorId, organizationId: "org" }),
    (message) => messages.push(message),
  );
  return {
    session,
    messages,
    service,
    denyExistingSession: () => {
      sessionAllowed = false;
    },
    revoke: () => {
      allowed = false;
    },
    publish: (message: SessionOutboundMessage) => publisher(message),
  };
}

test("same Project grant does not expose another member's Chat or transcript", async () => {
  const alice = harness("alice");
  const bob = harness("bob");
  await alice.session.handle({ type: "chat.list.request", requestId: "a" });
  await bob.session.handle({ type: "chat.list.request", requestId: "b" });
  expect(alice.messages[0]).toMatchObject({ payload: { chats: [chat] } });
  expect(bob.messages[0]).toMatchObject({ payload: { chats: [] } });
  await bob.session.handle({
    type: "chat.transcript.fetch.request",
    requestId: "c",
    chatId: chat.id,
  });
  expect(bob.service.fetchTranscript).not.toHaveBeenCalled();
  expect(bob.messages[1]).toMatchObject({ payload: { errorCode: "chat_request_failed" } });
  bob.publish({ type: "chat.updated", payload: { chat: chat as never } });
  expect(bob.messages).toHaveLength(2);
  alice.session.dispose();
  bob.session.dispose();
});

test("revoking a participant Project stops reads, sends and pushes on existing session", async () => {
  const h = harness("alice");
  await h.session.handle({ type: "chat.list.request", requestId: "a" });
  expect(h.session.allows(chat.id)).toBe(true);
  h.revoke();
  expect(h.session.allows(chat.id)).toBe(false);
  await h.session.handle({
    type: "chat.message.send.request",
    requestId: "s",
    chatId: chat.id,
    text: "secret",
  });
  expect(h.service.send).not.toHaveBeenCalled();
  h.publish({ type: "chat.updated", payload: { chat: chat as never } });
  expect(h.messages).toHaveLength(2);
  h.session.dispose();
});

test("denies a reused session whose effective configuration is no longer allowed", async () => {
  const h = harness("alice");
  const original = chat.participants[0]!.agentId;
  chat.participants[0]!.agentId = "agent-changed-in-cowork";
  try {
    h.denyExistingSession();
    await h.session.handle({
      type: "chat.message.send.request",
      requestId: "config",
      chatId: chat.id,
      text: "run",
    });
    expect(h.service.send).not.toHaveBeenCalled();
    expect(h.messages[0]).toMatchObject({
      payload: { error: "Existing Bot session configuration access denied" },
    });
  } finally {
    chat.participants[0]!.agentId = original;
    h.session.dispose();
  }
});

test("voice sends once through Chat with the current actor and spoken delivery metadata", async () => {
  const h = harness("alice");
  const original = chat.participants[0]!.agentId;
  chat.participants[0]!.agentId = "voice-agent";
  try {
    await h.session.sendSpokenInput(chat.id, "voice-agent", "Hello");
    expect(h.service.send).toHaveBeenCalledExactlyOnceWith({
      chatId: chat.id,
      text: "Hello",
      spokenInputAgentId: "voice-agent",
      actor: { kind: "user", id: "alice", organizationId: "org" },
    });
    h.revoke();
    await expect(h.session.sendSpokenInput(chat.id, "voice-agent", "Denied")).rejects.toThrow();
    expect(h.service.send).toHaveBeenCalledTimes(1);
  } finally {
    chat.participants[0]!.agentId = original;
    h.session.dispose();
  }
});

test("voice rejects another actor, stale binding and forbidden effective configuration", async () => {
  const alice = harness("alice");
  const bob = harness("bob");
  const original = chat.participants[0]!.agentId;
  chat.participants[0]!.agentId = "current-agent";
  try {
    await expect(bob.session.sendSpokenInput(chat.id, "current-agent", "Denied")).rejects.toThrow();
    await expect(alice.session.sendSpokenInput(chat.id, "old-agent", "Denied")).rejects.toThrow();
    alice.denyExistingSession();
    await expect(
      alice.session.sendSpokenInput(chat.id, "current-agent", "Denied"),
    ).rejects.toThrow();
    expect(alice.service.send).not.toHaveBeenCalled();
    expect(bob.service.send).not.toHaveBeenCalled();
  } finally {
    chat.participants[0]!.agentId = original;
    alice.session.dispose();
    bob.session.dispose();
  }
});

test("only the Chat owner with current Project access may update group settings", async () => {
  const request = {
    type: "chat.update.request" as const,
    requestId: "edit",
    chatId: chat.id,
    patch: { title: "Launch", requireMention: true },
  };
  const owner = harness("alice");
  await owner.session.handle(request);
  expect(owner.service.update).toHaveBeenCalledWith(chat.id, request.patch);
  expect(owner.messages.at(-1)).toMatchObject({
    type: "chat.update.response",
    payload: { error: null },
  });
  const other = harness("bob");
  await other.session.handle(request);
  expect(other.service.update).not.toHaveBeenCalled();
  expect(other.messages.at(-1)).toMatchObject({
    payload: { chat: null, errorCode: "chat_request_failed" },
  });
  owner.revoke();
  await owner.session.handle({ ...request, requestId: "revoked" });
  expect(owner.service.update).toHaveBeenCalledTimes(1);
  expect(owner.messages.at(-1)).toMatchObject({ payload: { errorCode: "chat_request_failed" } });
  owner.session.dispose();
  other.session.dispose();
});
