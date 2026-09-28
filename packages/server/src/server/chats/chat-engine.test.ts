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
  prompt: import("../agent/agent-sdk-types.js").AgentPromptInput;
  messageId: string;
  activeTurnBehavior?: "steer";
}

async function harness(options: { failPromptFor?: string[]; waitPrompt?: Promise<void> } = {}) {
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
  const createInputs: Parameters<ConstructorParameters<typeof BotSessions>[0]["createAgent"]>[0][] =
    [];
  const botSessions = new BotSessions({
    agentStorage: {
      get: async (id) => agents.get(id) ?? null,
      list: async () => [...agents.values()],
    },
    store,
    createAgent: async (input) => {
      createInputs.push(input);
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
  const liveAgents = new Map<
    string,
    {
      lifecycle: string;
      pendingPermissions: Map<string, unknown>;
      inFlightPermissionResponses: Set<string>;
    }
  >();
  const sent: SentPrompt[] = [];
  const appended: ChatMessagePayload[] = [];
  const updated: ChatPayload[] = [];
  const engine = new ChatEngine({
    store,
    transcriptOf,
    bots: { get: async (id) => bots.get(id) ?? null },
    botSessions,
    agentManager: {
      getAgent: (id) => liveAgents.get(id) as never,
      subscribe: (callback, subscribeOptions) => {
        subscribers.set(subscribeOptions?.agentId ?? "*", callback);
        return () => subscribers.delete(subscribeOptions?.agentId ?? "*");
      },
    },
    sendPrompt: async (params) => {
      if (options.failPromptFor?.includes(params.agentId)) throw new Error("provider is down");
      sent.push(params);
      await options.waitPrompt;
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
  return {
    store,
    engine,
    liveAgents,
    sent,
    appended,
    updated,
    completeTurn,
    failTurn,
    lines,
    agents,
    bots,
    createInputs,
  };
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
    expect(h.appended[0]?.sender).toEqual(actor);
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
    expect(h.sent[1]?.prompt).toBe("Long Luong (user:usr_1): Thanks, summarize it");
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
    expect(h.sent[1]?.prompt).not.toContain("user: one");
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

test.each(["running", "approval", "responding"])(
  "reset and removal preserve a bot with %s work",
  async (state) => {
    const h = await harness();
    await h.store.create({ id: "cht_guard", botIds: [alpha.id, beta.id] });
    await h.engine.send({ chatId: "cht_guard", text: "@alpha work", messageId: "guard-input" });
    await h.engine.idle();
    const agentId = h.sent[0]!.agentId;
    h.liveAgents.set(agentId, {
      lifecycle: state === "running" ? "running" : "idle",
      pendingPermissions: new Map(state === "approval" ? [["p1", {}]] : []),
      inFlightPermissionResponses: new Set(state === "responding" ? ["p1"] : []),
    });
    await expect(h.engine.newSession("cht_guard", alpha.id)).rejects.toThrow("Finish or stop");
    await expect(h.engine.removeParticipant("cht_guard", alpha.id)).rejects.toThrow(
      "Finish or stop",
    );
    expect((await h.store.require("cht_guard")).participants[0]?.agentId).toBe(agentId);
    expect(await h.lines("cht_guard")).toHaveLength(1);
    // Another idle bot in the same room remains independently manageable.
    await h.engine.removeParticipant("cht_guard", beta.id);
    h.liveAgents.set(agentId, {
      lifecycle: "idle",
      pendingPermissions: new Map(),
      inFlightPermissionResponses: new Set(),
    });
    await h.engine.newSession("cht_guard", alpha.id);
    expect((await h.store.require("cht_guard")).participants[0]?.agentId).toBeNull();
  },
);

test("reset and removal reject prompt admission before the provider is running", async () => {
  let release!: () => void;
  const h = await harness({
    waitPrompt: new Promise<void>((resolve) => {
      release = resolve;
    }),
  });
  await h.store.create({ id: "cht_admitting", botIds: [alpha.id, beta.id] });
  await h.engine.send({
    chatId: "cht_admitting",
    text: "@alpha work",
    messageId: "admission-input",
  });
  await expect.poll(() => h.sent.length).toBe(1);
  try {
    await expect(h.engine.newSession("cht_admitting", alpha.id)).rejects.toThrow(
      "receiving a message",
    );
    await expect(h.engine.removeParticipant("cht_admitting", alpha.id)).rejects.toThrow(
      "receiving a message",
    );
    expect((await h.store.require("cht_admitting")).participants).toHaveLength(2);
  } finally {
    release();
    await h.engine.idle();
  }
  await h.engine.removeParticipant("cht_admitting", alpha.id);
  expect((await h.store.require("cht_admitting")).participants.map((p) => p.botId)).toEqual([
    beta.id,
  ]);
});

test("group input contains other bot output once, never own output", async () => {
  const h = await harness();
  await h.store.create({ id: "cht_ingress", botIds: [alpha.id, beta.id] });
  await h.engine.send({ chatId: "cht_ingress", text: "round-one", messageId: "u1" });
  await h.engine.idle();
  const a = h.sent.find((p) => p.agentId.includes(alpha.id))!.agentId;
  const b = h.sent.find((p) => p.agentId.includes(beta.id))!.agentId;
  await h.completeTurn(a, "alpha-answer");
  await h.completeTurn(b, "beta-answer");
  await h.engine.send({ chatId: "cht_ingress", text: "round-two", messageId: "u2" });
  await h.engine.idle();
  const ap = h.sent.filter((p) => p.agentId === a)[1]!.prompt;
  const bp = h.sent.filter((p) => p.agentId === b)[1]!.prompt;
  expect(ap).toContain("beta-answer");
  expect(ap).not.toContain("alpha-answer");
  expect(bp).toContain("alpha-answer");
  expect(bp).not.toContain("beta-answer");
  expect(ap + bp).not.toContain("round-one");
  await h.engine.send({ chatId: "cht_ingress", text: "round-three", messageId: "u3" });
  await h.engine.idle();
  expect(h.sent.slice(-2).map((p) => p.prompt)).toEqual(["user: round-three", "user: round-three"]);
});

test("late forwarding does not resend a bot line already consumed as context", async () => {
  const h = await harness();
  await h.store.create({ id: "cht_overtake", botIds: [alpha.id, beta.id] });
  await h.engine.send({ chatId: "cht_overtake", text: "@alpha start", messageId: "u1" });
  await h.engine.idle();
  const append = h.engine.appendLine.bind(h.engine);
  let release!: () => void;
  let stored!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const written = new Promise<void>((resolve) => {
    stored = resolve;
  });
  h.engine.appendLine = async (chatId, input) => {
    const line = await append(chatId, input);
    if (input.sender.kind === "bot") {
      stored();
      await paused;
    }
    return line;
  };
  const completion = h.completeTurn(h.sent[0]!.agentId, "@beta forwarded-once");
  await written;
  try {
    await h.engine.send({ chatId: "cht_overtake", text: "@beta next", messageId: "u2" });
    await expect.poll(() => h.sent.length).toBe(2);
  } finally {
    release();
    await completion;
  }
  expect(h.sent).toHaveLength(2);
  expect(h.sent[1]!.prompt).toContain("forwarded-once");
  expect(
    (await h.store.require("cht_overtake")).participants.find((p) => p.botId === beta.id)
      ?.deliveredSeq,
  ).toBe(3);
});

test("mentions-only spoken Chat input targets the selected active voice bot", async () => {
  const h = await harness();
  await h.store.create({ id: "cht_voice", botIds: [alpha.id, beta.id] });
  await h.engine.send({ chatId: "cht_voice", text: "Start", messageId: "initial" });
  await h.engine.idle();
  await h.store.updateSettings("cht_voice", { requireMention: true });
  const selectedAgent = (await h.store.require("cht_voice")).participants[0]!.agentId!;
  h.sent.length = 0;
  const response = await h.engine.send({
    chatId: "cht_voice",
    text: "Hello",
    messageId: "voice-1",
    actor,
    spokenInputAgentId: selectedAgent,
  });
  await h.engine.idle();
  expect(response.targets).toEqual([alpha.id]);
  expect((await h.lines("cht_voice")).filter((line) => line.id === "voice-1")).toHaveLength(1);
  expect((await h.lines("cht_voice")).find((line) => line.id === "voice-1")).toMatchObject({
    text: "Hello",
    spokenInputAgentId: selectedAgent,
  });
  expect(h.sent).toHaveLength(1);
  expect(h.sent[0]!.agentId).toBe(selectedAgent);
  expect(h.sent[0]!.prompt).toContain("<spoken-input>");
  await expect(
    h.engine.send({
      chatId: "cht_voice",
      text: "Spoof",
      messageId: "spoof",
      spokenInputAgentId: "outside-session",
    }),
  ).rejects.toThrow("active Chat participant");
  expect((await h.lines("cht_voice")).some((line) => line.id === "spoof")).toBe(false);
});

test("chat attachments persist, fan out once, and full-payload retries conflict", async () => {
  const h = await harness();
  await h.store.create({ id: "files", botIds: [alpha.id, beta.id] });
  const input = {
    chatId: "files",
    text: "",
    messageId: "f1",
    images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
    attachments: [
      { type: "text" as const, mimeType: "text/plain" as const, text: "spec", title: "Spec" },
    ],
  };
  await h.engine.send(input);
  await h.engine.idle();
  expect(h.sent).toHaveLength(2);
  for (const sent of h.sent)
    expect(sent.prompt).toEqual(
      expect.arrayContaining([{ type: "image", ...input.images[0] }, input.attachments[0]]),
    );
  expect((await h.lines("files"))[0]).toMatchObject({
    images: input.images,
    attachments: input.attachments,
  });
  expect((await h.engine.send(input)).duplicate).toBe(true);
  await expect(
    h.engine.send({ ...input, images: [{ data: "b3RoZXI=", mimeType: "image/png" }] }),
  ).rejects.toThrow("different text or attachments");
  await h.engine.send({ chatId: "files", text: "Next", messageId: "f2" });
  await h.engine.idle();
  expect(h.sent.slice(2).every((sent) => typeof sent.prompt === "string")).toBe(true);
});

test("chat upload preparation rejects before accepting a transcript", async () => {
  const h = await harness();
  await h.store.create({ id: "denied-files", botIds: [alpha.id] });
  await expect(
    h.engine.send({
      chatId: "denied-files",
      text: "file",
      prepareFiles: async () => {
        throw new Error("Upload owner denied");
      },
    }),
  ).rejects.toThrow("Upload owner denied");
  expect(await h.lines("denied-files")).toEqual([]);
  expect(h.sent).toEqual([]);
});

test("uploaded chat files use existing durable staging before fanout and survive log reopen", async () => {
  const { attachSessionFiles } = await import("../file-upload/session-files.js");
  const h = await harness();
  await h.store.create({ id: "durable-files", botIds: [alpha.id, beta.id] });
  const source = path.join(roots.at(-1)!, "upload.txt");
  await fs.writeFile(source, "durable content");
  const attachment = {
    type: "uploaded_file" as const,
    id: "file_1",
    fileName: "upload.txt",
    mimeType: "text/plain",
    size: 15,
    path: source,
  };
  const input = {
    chatId: "durable-files",
    messageId: "upload1",
    text: "Read",
    attachments: [attachment],
  };
  await expect(
    h.engine.send({
      ...input,
      prepareFiles: async (directory, messageId, files) =>
        attachSessionFiles({ directory, messageId, ...files, ownsUpload: () => false }),
    }),
  ).rejects.toThrow("does not belong");
  expect(await h.lines("durable-files")).toEqual([]);
  await h.engine.send({
    ...input,
    prepareFiles: async (directory, messageId, files) =>
      attachSessionFiles({
        directory,
        messageId,
        ...files,
        ownsUpload: (file) => file.id === attachment.id && file.path === source,
      }),
  });
  await h.engine.idle();
  await fs.unlink(source);
  const log = new TranscriptLog(h.store.directory("durable-files"));
  const line = (await log.fetch({ limit: 0 })).lines[0]!;
  const stored = line.attachments![0];
  expect(stored.type).toBe("uploaded_file");
  if (stored.type !== "uploaded_file") throw new Error("Expected file");
  expect(await fs.readFile(stored.path, "utf8")).toBe("durable content");
  expect(h.sent).toHaveLength(2);
  for (const sent of h.sent) expect(sent.prompt).toEqual(expect.arrayContaining([stored]));
  expect((await h.engine.send(input)).duplicate).toBe(true);
});

test("chat releases upload ownership only after transcript acceptance", async () => {
  const h = await harness();
  await h.store.create({ id: "release-files", botIds: [alpha.id] });
  let released = false;
  await h.engine.send({
    chatId: "release-files",
    text: "Ready",
    messageId: "r1",
    prepareFiles: async () => ({
      release: async () => {
        expect((await h.lines("release-files"))[0]?.id).toBe("r1");
        released = true;
      },
    }),
  });
  await h.engine.idle();
  expect(released).toBe(true);
});

test("updated reply policy applies to subsequent messages without resetting group sessions", async () => {
  const h = await harness();
  await h.store.create({ id: "editable-group", botIds: [alpha.id, beta.id] });
  expect(
    (await h.engine.send({ chatId: "editable-group", text: "First", messageId: "before" })).targets,
  ).toEqual([alpha.id, beta.id]);
  await h.engine.idle();
  const sessions = (await h.store.require("editable-group")).participants.map((p) => p.agentId);
  await h.store.updateSettings("editable-group", { requireMention: true });
  expect(
    (await h.engine.send({ chatId: "editable-group", text: "Quiet", messageId: "quiet" })).targets,
  ).toEqual([]);
  expect(
    (await h.engine.send({ chatId: "editable-group", text: "@alpha next", messageId: "after" }))
      .targets,
  ).toEqual([alpha.id]);
  await h.engine.idle();
  expect((await h.store.require("editable-group")).participants.map((p) => p.agentId)).toEqual(
    sessions,
  );
});

describe("group room contract (plans/group-discussion.md)", () => {
  const systemPromptOf = (input: unknown) =>
    (input as { config?: { systemPrompt?: string } }).config?.systemPrompt;

  test("a group session starts with the room contract; a direct one does not", async () => {
    const h = await harness();
    h.bots.set(beta.id, { ...beta, description: "Owns the numbers" });
    await h.store.create({ id: "cht_g", title: "Launch", botIds: [alpha.id, beta.id] });
    await h.store.create({ id: "cht_d", botIds: [alpha.id] });
    await h.engine.send({ chatId: "cht_g", text: "status?", messageId: "m1" });
    await h.engine.send({ chatId: "cht_d", text: "hi", messageId: "m2" });
    await h.engine.idle();
    const [alphaInGroup, betaInGroup, alphaDirect] = h.createInputs.map(systemPromptOf);
    expect(alphaInGroup).toContain('You are Alpha (@alpha) in the group chat "Launch".');
    expect(alphaInGroup).toContain("- @beta — Beta — Owns the numbers");
    expect(betaInGroup).toContain("You are Beta (@beta)");
    expect(alphaDirect).toBeUndefined();
    // A fresh session read the room in its system prompt, so the first prompt is the message.
    expect(h.sent.every((prompt) => !String(prompt.prompt).includes("[Room update]"))).toBe(true);
  });

  test("a change to the members is told once, on the next wake of each existing session", async () => {
    const h = await harness();
    await h.store.create({ id: "cht_g", botIds: [alpha.id, beta.id] });
    await h.engine.send({ chatId: "cht_g", text: "first", messageId: "m1" });
    await h.engine.idle();
    h.bots.set(beta.id, { ...beta, description: "Owns the numbers" });
    await h.engine.send({ chatId: "cht_g", text: "@alpha second", messageId: "m2" });
    await h.engine.send({ chatId: "cht_g", text: "@alpha third", messageId: "m3" });
    await h.engine.idle();
    const alphaPrompts = h.sent
      .filter((prompt) => prompt.agentId === "agent-bot_a-1")
      .map((prompt) => String(prompt.prompt));
    expect(alphaPrompts[1]?.startsWith("[Room update]")).toBe(true);
    expect(alphaPrompts[1]).toContain("- @beta — Beta — Owns the numbers");
    expect(alphaPrompts[1]).toContain("user: @alpha second");
    expect(alphaPrompts[2]).not.toContain("[Room update]");
  });

  test("PASS and an empty turn are silence in a group: no line, no notice, no forwarding", async () => {
    const h = await harness();
    await h.store.create({ id: "cht_g", botIds: [alpha.id, beta.id] });
    await h.engine.send({ chatId: "cht_g", text: "@alpha @beta thoughts?", messageId: "m1" });
    await h.engine.idle();
    await h.completeTurn("agent-bot_a-1", "PASS");
    await h.completeTurn("agent-bot_b-2", null);
    expect((await h.lines("cht_g")).map((line) => line.text)).toEqual(["@alpha @beta thoughts?"]);
    expect(h.sent).toHaveLength(2);
  });
});
