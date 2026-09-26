import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ChatMessagePayload, ChatPayload } from "@getpaseo/protocol/chats/types";
import { CONTEXT_HEADER, MESSAGE_HEADER } from "@getpaseo/protocol/conversation-prompt";
import { createTestLogger } from "../../test-utils/test-logger.js";
import type { AgentSubscriber } from "../agent/agent-manager.js";
import type { AgentStreamEvent } from "../agent/agent-sdk-types.js";
import type { StoredAgentRecord } from "../agent/agent-storage.js";
import { BotSessions } from "./bot-sessions.js";
import { ChatEngine } from "./chat-engine.js";
import type { ChatBot } from "./chat-record.js";
import { ChatStore } from "./chat-store.js";
import { SessionEventLog } from "../agent/session-storage/session-event-log.js";
import { TranscriptLog } from "./transcript-log.js";

const roots: string[] = [];
afterEach(async () => {
  SessionEventLog.forgetAll();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const alpha: ChatBot = {
  id: "bot_a",
  slug: "alpha",
  displayName: "Alpha",
  workspaceId: "wks_a",
  cwd: "/bots/alpha",
  launch: { provider: "codex" },
};
const beta: ChatBot = {
  ...alpha,
  id: "bot_b",
  slug: "beta",
  displayName: "Beta",
  cwd: "/bots/beta",
};
const actor = { kind: "user" as const, id: "usr_1", displayName: "Long Luong" };

interface SentPrompt {
  agentId: string;
  prompt: string;
  messageId: string;
  activeTurnBehavior?: "steer";
}

async function harness(options: { failPromptFor?: string[] } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chat-engine-"));
  roots.push(root);
  const logger = createTestLogger();
  const store = new ChatStore(root, logger);
  const transcripts = new Map<string, TranscriptLog>();
  const transcriptOf = (chatId: string) => {
    let log = transcripts.get(chatId);
    if (!log) transcripts.set(chatId, (log = new TranscriptLog(store.directory(chatId))));
    return log;
  };
  const bots = new Map([
    [alpha.id, alpha],
    [beta.id, beta],
  ]);
  const agents = new Map<string, StoredAgentRecord>();
  let created = 0;
  const botSessions = new BotSessions({
    agentStorage: {
      get: async (id) => agents.get(id) ?? null,
      list: async () => [...agents.values()],
    },
    store,
    createAgent: async (input) => {
      const id = `agent-${input.kind === "mcp" ? input.labels?.["clisbot.bot-id"] : "x"}-${++created}`;
      agents.set(id, {
        id,
        provider: "codex",
        cwd: "/",
        createdAt: new Date().toISOString(),
        updatedAt: "",
        labels: input.kind === "mcp" ? (input.labels ?? {}) : {},
        lastStatus: "idle",
        config: {},
      } as StoredAgentRecord);
      return { snapshot: { id } } as never;
    },
    ensureLoaded: async () => undefined,
  });
  const subscribers = new Map<string, AgentSubscriber>();
  const sent: SentPrompt[] = [];
  const appended: ChatMessagePayload[] = [];
  const updated: ChatPayload[] = [];
  const engine = new ChatEngine({
    store,
    transcriptOf,
    bots: { get: async (id) => bots.get(id) ?? null },
    botSessions,
    agentManager: {
      subscribe: (callback, subscribeOptions) => {
        subscribers.set(subscribeOptions?.agentId ?? "*", callback);
        return () => subscribers.delete(subscribeOptions?.agentId ?? "*");
      },
    },
    sendPrompt: async (params) => {
      if (options.failPromptFor?.includes(params.agentId)) throw new Error("provider is down");
      sent.push(params);
      return { disposition: "turn_started" };
    },
    publisher: {
      transcriptAppended: (_chatId, line) => appended.push(line),
      chatUpdated: (chat) => updated.push(chat),
    },
    logger,
  });
  let seq = 0;
  const emit = (agentId: string, event: AgentStreamEvent) =>
    subscribers.get(agentId)?.({ type: "agent_stream", agentId, event, epoch: "ep", seq: ++seq });
  const completeTurn = async (
    agentId: string,
    text: string | null,
    turnId = `turn-${agentId}-${seq}`,
  ) => {
    emit(agentId, { type: "turn_started", provider: "codex", turnId });
    if (text !== null)
      emit(agentId, {
        type: "timeline",
        provider: "codex",
        turnId,
        item: { type: "assistant_message", text, messageId: "m" },
      });
    emit(agentId, { type: "turn_completed", provider: "codex", turnId });
    await engine.idle();
  };
  const failTurn = async (agentId: string, error: string) => {
    const turnId = `turn-${agentId}-${seq}`;
    emit(agentId, { type: "turn_started", provider: "codex", turnId });
    emit(agentId, { type: "turn_failed", provider: "codex", turnId, error });
    await engine.idle();
  };
  const lines = async (chatId: string) => (await transcriptOf(chatId).fetch({ limit: 0 })).lines;
  return { store, engine, sent, appended, updated, completeTurn, failTurn, lines, agents };
}

describe("ChatEngine", () => {
  test("a direct chat: the user line is written before the prompt, the reply lands with its reference", async () => {
    const h = await harness();
    await h.store.create({ id: "cht_1", title: "Research sync", botIds: [alpha.id] });
    const result = await h.engine.send({
      chatId: "cht_1",
      text: "Find the spec",
      messageId: "m1",
      actor,
    });
    expect(result).toEqual({ messageId: "m1", seq: 1, targets: [alpha.id], duplicate: false });
    expect(h.appended.map((line) => line.id)).toEqual(["m1"]);
    expect(h.appended[0]?.deliveryBotIds).toEqual([alpha.id]);
    await h.engine.idle();
    expect(h.sent).toEqual([
      {
        agentId: "agent-bot_a-1",
        prompt: "Long Luong (user:usr_1): Find the spec",
        messageId: "m1",
        activeTurnBehavior: "steer",
      },
    ]);
    expect((await h.store.require("cht_1")).participants[0]).toMatchObject({
      agentId: "agent-bot_a-1",
      deliveredSeq: 1,
    });

    await h.completeTurn("agent-bot_a-1", "Here it is.", "turn-1");
    expect((await h.store.require("cht_1")).participants[0]?.completedTurn).toMatchObject({
      agentId: "agent-bot_a-1",
      turnId: "turn-1",
      messageIds: ["m1"],
      lastRow: { epoch: "ep", seq: 2 },
    });
    const [, reply] = await h.lines("cht_1");
    expect(reply).toMatchObject({
      seq: 2,
      sender: { kind: "bot", botId: alpha.id },
      text: "Here it is.",
      reply: { agentId: "agent-bot_a-1", turnId: "turn-1", epoch: "ep", seq: 2 },
      inReplyTo: "m1",
      hop: 1,
    });
    expect(h.appended.map((line) => line.seq)).toEqual([1, 2]);
    expect((await h.store.require("cht_1")).lastMessageAt).toBe(reply!.at);

    await h.engine.send({ chatId: "cht_1", text: "Thanks, summarize it", messageId: "m2", actor });
    await h.engine.idle();
    expect(h.sent[1]?.prompt).toBe(
      [
        CONTEXT_HEADER,
        "Alpha (bot:alpha): Here it is.",
        MESSAGE_HEADER,
        "Long Luong (user:usr_1): Thanks, summarize it",
      ].join("\n"),
    );
  });

  test("concurrent messages admit in order without consuming future context", async () => {
    const h = await harness();
    await h.store.create({ id: "cht_1", botIds: [alpha.id] });
    await Promise.all([
      h.engine.send({ chatId: "cht_1", text: "first", messageId: "m1" }),
      h.engine.send({ chatId: "cht_1", text: "second", messageId: "m2" }),
    ]);
    await h.engine.idle();
    expect(h.sent.map((item) => item.prompt)).toEqual(["user: first", "user: second"]);
    expect(h.agents.size).toBe(1);
    expect((await h.store.require("cht_1")).participants[0]?.deliveredSeq).toBe(2);
  });

  test("a group: no mention reaches every bot in parallel, a mention reaches one and leaves the other's mark alone", async () => {
    const h = await harness();
    await h.store.create({ id: "cht_1", botIds: [alpha.id, beta.id] });
    await h.engine.send({ chatId: "cht_1", text: "status?", messageId: "m1" });
    await h.engine.idle();
    expect(h.sent.map((prompt) => prompt.agentId).sort()).toEqual([
      "agent-bot_a-1",
      "agent-bot_b-2",
    ]);
    expect(h.sent.every((prompt) => prompt.prompt === "user: status?")).toBe(true);

    const second = await h.engine.send({
      chatId: "cht_1",
      text: "@beta only you",
      messageId: "m2",
    });
    await h.engine.idle();
    expect(second.targets).toEqual([beta.id]);
    expect(h.sent).toHaveLength(3);
    expect(h.sent[2]).toMatchObject({ agentId: "agent-bot_b-2", prompt: "user: @beta only you" });
    const chat = await h.store.require("cht_1");
    expect(chat.participants.map((entry) => [entry.botId, entry.deliveredSeq])).toEqual([
      [alpha.id, 1],
      [beta.id, 2],
    ]);
  });

  test("a bot mentioning another bot is forwarded once, and the chain ends at the hop limit with a notice", async () => {
    const h = await harness();
    await h.store.create({ id: "cht_1", botIds: [alpha.id, beta.id], rules: { hops: { max: 1 } } });
    await h.engine.send({
      chatId: "cht_1",
      text: "@alpha ask beta for the numbers",
      messageId: "m1",
    });
    await h.engine.idle();
    await h.completeTurn("agent-bot_a-1", "@beta what are the numbers?");
    expect(h.sent[1]).toMatchObject({
      agentId: "agent-bot_b-2",
      prompt: [
        CONTEXT_HEADER,
        "user: @alpha ask beta for the numbers",
        MESSAGE_HEADER,
        "Alpha (bot:alpha): @beta what are the numbers?",
      ].join("\n"),
    });
    await h.completeTurn("agent-bot_b-2", "@alpha 42");
    await h.engine.idle();
    const lines = await h.lines("cht_1");
    expect(lines.map((line) => [line.sender.kind, line.hop, line.text])).toEqual([
      ["user", 0, "@alpha ask beta for the numbers"],
      ["bot", 1, "@beta what are the numbers?"],
      ["bot", 2, "@alpha 42"],
      [
        "system",
        0,
        "⚠️ Beta mentioned @alpha, but the hop limit (1) was reached; nothing was forwarded.",
      ],
    ]);
    expect(lines[2]?.inReplyTo).toBe(lines[1]?.id);
    expect(h.sent).toHaveLength(2);
  });

  test("the same message id is written once; a different text under it is refused", async () => {
    const h = await harness();
    await h.store.create({ id: "cht_1", botIds: [alpha.id] });
    const first = await h.engine.send({ chatId: "cht_1", text: "hello", messageId: "m1" });
    const again = await h.engine.send({ chatId: "cht_1", text: "hello", messageId: "m1" });
    expect(again).toEqual({ messageId: "m1", seq: first.seq, targets: [], duplicate: true });
    await expect(
      h.engine.send({ chatId: "cht_1", text: "other", messageId: "m1" }),
    ).rejects.toThrow("already exists with different text");
    await h.engine.idle();
    expect(await h.lines("cht_1")).toHaveLength(1);
    expect(h.sent).toHaveLength(1);
  });

  test("a failed turn, a delivery failure and a reply-less turn each leave a system line", async () => {
    const h = await harness({ failPromptFor: ["agent-bot_b-2"] });
    await h.store.create({ id: "cht_1", botIds: [alpha.id, beta.id] });
    await h.engine.send({ chatId: "cht_1", text: "go", messageId: "m1" });
    await h.engine.idle();
    await h.failTurn("agent-bot_a-1", "  rate   limited\nby provider ");
    await h.completeTurn("agent-bot_a-1", null);
    const texts = (await h.lines("cht_1")).map((line) => `${line.sender.kind}: ${line.text}`);
    expect(texts).toEqual([
      "user: go",
      "system: ⚠️ Beta could not take the message: provider is down",
      "system: ⚠️ Alpha stopped with an error: rate limited by provider",
    ]);
    expect(h.sent).toHaveLength(1);
  });

  test("/new leaves a system line and the next delivery goes to a fresh session", async () => {
    const h = await harness();
    await h.store.create({ id: "cht_1", botIds: [alpha.id] });
    await h.engine.send({ chatId: "cht_1", text: "one", messageId: "m1" });
    await h.engine.idle();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await h.engine.newSession("cht_1", alpha.id);
    await h.engine.send({ chatId: "cht_1", text: "two", messageId: "m2" });
    await h.engine.idle();
    expect(h.sent.map((prompt) => prompt.agentId)).toEqual(["agent-bot_a-1", "agent-bot_a-2"]);
    expect((await h.lines("cht_1")).map((line) => line.text)).toEqual([
      "one",
      "Alpha will start a new session on the next message.",
      "two",
    ]);
  });

  test("refuses an over-limit message and a message to an archived chat", async () => {
    const h = await harness();
    await h.store.create({
      id: "cht_1",
      botIds: [alpha.id],
      rules: { limits: { maxInputCharacters: 3 } },
    });
    await expect(h.engine.send({ chatId: "cht_1", text: "four" })).rejects.toThrow(
      "Message is 4 characters; this chat accepts at most 3.",
    );
    await h.store.archive("cht_1");
    await expect(h.engine.send({ chatId: "cht_1", text: "hi" })).rejects.toThrow("is archived");
    expect(await h.lines("cht_1")).toEqual([]);
  });
});

test("removed bots and pre-/new sessions cannot publish or forward late outcomes", async () => {
  const h = await harness();
  await h.store.create({ id: "cht_late", botIds: [alpha.id, beta.id] });
  await h.engine.send({ chatId: "cht_late", text: "@alpha start", messageId: "late-input" });
  await h.engine.idle();
  const outcome = {
    agentId: "agent-bot_a-1",
    chatId: "cht_late",
    botId: alpha.id,
    turnId: "late-turn",
    text: "@beta unwanted",
    lastRow: null,
    expectation: null,
  };
  await h.store.removeParticipant("cht_late", alpha.id);
  await h.engine.onTurnCompleted(outcome);
  await h.engine.onTurnFailed(outcome, "late error");
  expect(await h.lines("cht_late")).toHaveLength(1);
  expect(h.sent).toHaveLength(1);
  await h.store.addParticipant("cht_late", alpha.id);
  await h.engine.newSession("cht_late", alpha.id);
  await h.engine.onTurnCompleted(outcome);
  expect((await h.lines("cht_late")).some((line) => line.text.includes("unwanted"))).toBe(false);
});

test("a failed completion receipt write never publishes recovered text as a final answer", async () => {
  const h = await harness();
  await h.store.create({ id: "cht_receipt_fail", botIds: [alpha.id] });
  await h.engine.send({ chatId: "cht_receipt_fail", text: "hello", messageId: "m1" });
  await h.engine.idle();
  h.store.recordCompletedTurn = async () => {
    throw new Error("disk unavailable");
  };
  await expect(
    h.engine.onTurnCompleted({
      agentId: "agent-bot_a-1",
      chatId: "cht_receipt_fail",
      botId: alpha.id,
      turnId: "turn",
      text: "not committed",
      lastRow: { epoch: "ep", seq: 2 },
      expectation: { messageIds: ["m1"], hop: 0, disposition: "turn_started" },
    }),
  ).rejects.toThrow("disk unavailable");
  await h.engine.idle();
  expect((await h.lines("cht_receipt_fail")).map((line) => line.text)).toEqual(["hello"]);
});
