import { describe, expect, test } from "vitest";
import type { ChatMessagePayload } from "@getpaseo/protocol/chats/types";
import { createTestLogger } from "../../test-utils/test-logger.js";
import type { AgentTimelineRow } from "../agent/agent-timeline-store-types.js";
import type { StoredChat } from "./chat-record.js";
import { reconcileChats, type ReconcileDependencies } from "./reconcile.js";
import type { TranscriptLineInput } from "./transcript-log.js";

const alpha = { id: "bot_a", slug: "alpha", displayName: "Alpha" };

function receipt(seq: number) {
  return {
    agentId: "agent-a",
    turnId: "turn-9",
    messageIds: ["m1"],
    lastRow: { epoch: "ep", seq },
  };
}

function chat(overrides: Partial<StoredChat> = {}): StoredChat {
  return {
    id: "cht_1",
    title: null,
    participants: [
      {
        botId: alpha.id,
        addedAt: "t",
        agentId: "agent-a",
        resetAt: null,
        deliveredSeq: 1,
        completedTurn: receipt(14),
      },
    ],
    rules: {},
    createdAt: "t",
    updatedAt: "t",
    lastMessageAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function line(seq: number, overrides: Partial<ChatMessagePayload> = {}): ChatMessagePayload {
  return {
    id: `m${seq}`,
    seq,
    at: "t",
    sender: { kind: "user" },
    text: `text ${seq}`,
    hop: 0,
    ...overrides,
  };
}

function row(seq: number, item: AgentTimelineRow["item"], turnId = "turn-9"): AgentTimelineRow {
  return { seq, timestamp: "t", item, turnId };
}

function harness(options: {
  chats?: StoredChat[];
  lines?: ChatMessagePayload[];
  running?: string[];
  submitted?: Record<string, { epoch: string; seq: number }>;
  rows?: AgentTimelineRow[];
}) {
  const appended: { chatId: string; input: TranscriptLineInput }[] = [];
  const lookups: string[] = [];
  const repaired: number[] = [];
  const deps: ReconcileDependencies = {
    store: {
      list: async () => options.chats ?? [chat()],
      markDelivered: async (_chatId, _botId, seq) => {
        repaired.push(seq);
        return chat();
      },
    },
    transcriptOf: () => ({
      fetch: async () => ({
        lines: options.lines ?? [],
        hasOlder: false,
        hasNewer: false,
        startSeq: 0,
        endSeq: 0,
      }),
    }),
    bots: {
      get: async (id) =>
        id === alpha.id
          ? { ...alpha, workspaceId: "w", cwd: "/", launch: { provider: "codex" } }
          : null,
    },
    appendLine: async (chatId, input) => {
      appended.push({ chatId, input });
    },
    isRunning: (agentId) => options.running?.includes(agentId) ?? false,
    findSubmittedRow: async (_agentId, messageId) => {
      lookups.push(messageId);
      return options.submitted?.[messageId] ?? null;
    },
    rowsAfter: async () => options.rows ?? [],
    logger: createTestLogger(),
    now: () => "2026-09-26T12:00:00.000Z",
  };
  return { deps, appended, lookups, repaired };
}

describe("reconcileChats", () => {
  test("backfills the reply from the timeline rows after the submitted user row", async () => {
    const h = harness({
      lines: [line(1)],
      submitted: { m1: { epoch: "ep", seq: 10 } },
      rows: [
        row(11, { type: "assistant_message", text: "Let me check.", messageId: "a1" }),
        row(12, { type: "tool_call", callId: "c", name: "read", status: "completed" } as never),
        row(13, { type: "assistant_message", text: "Fou", messageId: "a2" }),
        row(14, { type: "assistant_message", text: "nd it", messageId: "a2" }),
        row(15, { type: "user_message", text: "later prompt" }),
        row(16, { type: "assistant_message", text: "not this turn", messageId: "a3" }),
      ],
    });
    await reconcileChats(h.deps);
    expect(h.lookups).toEqual(["m1"]);
    expect(h.appended).toEqual([
      {
        chatId: "cht_1",
        input: {
          id: expect.any(String),
          at: "2026-09-26T12:00:00.000Z",
          sender: { kind: "bot", botId: alpha.id },
          text: "Found it",
          reply: { agentId: "agent-a", turnId: "turn-9", epoch: "ep", seq: 14 },
          inReplyTo: "m1",
          hop: 1,
          deliveryBotIds: [],
        },
      },
    ]);
  });

  test("leaves a chat alone when the reply landed, nothing was delivered, or the agent is running", async () => {
    const answered = harness({
      lines: [
        line(1),
        line(2, {
          sender: { kind: "bot", botId: alpha.id },
          reply: { agentId: "agent-a" },
          hop: 1,
        }),
      ],
    });
    await reconcileChats(answered.deps);
    expect(answered.appended).toEqual([]);
    expect(answered.lookups).toEqual([]);

    const undelivered = harness({
      chats: [
        chat({
          participants: [
            { botId: alpha.id, addedAt: "t", agentId: "agent-a", resetAt: null, deliveredSeq: 0 },
          ],
        }),
      ],
      lines: [line(1)],
    });
    await reconcileChats(undelivered.deps);
    expect(undelivered.appended).toEqual([]);

    const running = harness({ lines: [line(1)], running: ["agent-a"] });
    await reconcileChats(running.deps);
    expect(running.appended).toEqual([]);
    expect(running.lookups).toEqual([]);

    const archived = harness({ chats: [chat({ archivedAt: "t" })], lines: [line(1)] });
    await reconcileChats(archived.deps);
    expect(archived.appended).toEqual([]);
  });

  test("one bot's failure notice does not hide another bot's missing reply", async () => {
    const h = harness({
      lines: [
        line(1),
        line(2, {
          sender: { kind: "system" },
          text: "⚠️ Beta stopped while the daemon was down; no reply was recorded.",
          reply: { agentId: "agent-b" },
          inReplyTo: "m1",
        }),
      ],
      submitted: { m1: { epoch: "ep", seq: 10 } },
      rows: [row(14, { type: "assistant_message", text: "Recovered", messageId: "a1" })],
    });
    await reconcileChats(h.deps);
    expect(h.appended[0]?.input).toMatchObject({ text: "Recovered", inReplyTo: "m1" });
  });

  test("records a failure line when the turn left no text or the history is provider-only, once", async () => {
    const noText = harness({
      lines: [line(1)],
      submitted: { m1: { epoch: "ep", seq: 10 } },
      rows: [
        row(11, { type: "tool_call", callId: "c", name: "read", status: "completed" } as never),
      ],
    });
    await reconcileChats(noText.deps);
    expect(noText.appended.map((entry) => entry.input.text)).toEqual([
      "⚠️ Alpha stopped while the daemon was down; no reply was recorded.",
    ]);

    const providerOnly = harness({ lines: [line(1)] });
    await reconcileChats(providerOnly.deps);
    expect(
      providerOnly.appended.map((entry) => [entry.input.sender.kind, entry.input.text]),
    ).toEqual([["system", "⚠️ Alpha stopped while the daemon was down; no reply was recorded."]]);

    const alreadyNoted = harness({
      lines: [
        line(1),
        line(2, {
          sender: { kind: "system" },
          text: "⚠️ Alpha stopped while the daemon was down; no reply was recorded.",
          reply: { agentId: "agent-a" },
          inReplyTo: "m1",
        }),
      ],
    });
    await reconcileChats(alreadyNoted.deps);
    expect(alreadyNoted.appended).toEqual([]);
  });
});

test("accepted targets survive a crash before any session or prompt was admitted", async () => {
  const input = line(1, { deliveryBotIds: [alpha.id] });
  const pending = chat({
    participants: [
      { botId: alpha.id, addedAt: "t", agentId: null, resetAt: null, deliveredSeq: 0 },
    ],
  });
  const h = harness({ chats: [pending], lines: [input] });
  await reconcileChats(h.deps);
  expect(h.lookups).toEqual([]);
  expect(h.appended).toHaveLength(1);
  expect(h.appended[0]?.input).toMatchObject({
    sender: { kind: "system" },
    inReplyTo: input.id,
    deliveryBotIds: [alpha.id],
  });
  const reopened = harness({
    chats: [pending],
    lines: [input, { ...h.appended[0]!.input, seq: 2 }],
  });
  await reconcileChats(reopened.deps);
  expect(reopened.appended).toEqual([]);
});

test("backfills an admitted prompt even when the delivered watermark never persisted", async () => {
  const h = harness({
    chats: [
      chat({
        participants: [
          {
            botId: alpha.id,
            addedAt: "t",
            agentId: "agent-a",
            resetAt: null,
            deliveredSeq: 0,
            completedTurn: receipt(11),
          },
        ],
      }),
    ],
    lines: [line(1, { deliveryBotIds: [alpha.id] })],
    submitted: { m1: { epoch: "ep", seq: 10 } },
    rows: [row(11, { type: "assistant_message", text: "Durable answer", messageId: "a1" })],
  });
  await reconcileChats(h.deps);
  expect(h.appended[0]?.input).toMatchObject({
    text: "Durable answer",
    inReplyTo: "m1",
    sender: { kind: "bot", botId: alpha.id },
  });
});

test("target snapshots and terminal notices prevent false or duplicate failure reports", async () => {
  const h = harness({ lines: [line(1, { deliveryBotIds: [] })] });
  await reconcileChats(h.deps);
  expect(h.appended).toEqual([]);
  const failed = harness({
    lines: [
      line(1, { deliveryBotIds: [alpha.id] }),
      line(2, {
        sender: { kind: "system" },
        text: "provider failed",
        inReplyTo: "m1",
        deliveryBotIds: [alpha.id],
      }),
    ],
  });
  await reconcileChats(failed.deps);
  expect(failed.appended).toEqual([]);
});

test("partial text without durable completion proof stays a scoped interruption notice", async () => {
  const h = harness({
    chats: [
      chat({
        participants: [
          { botId: alpha.id, addedAt: "t", agentId: "agent-a", resetAt: null, deliveredSeq: 1 },
        ],
      }),
    ],
    lines: [line(1, { deliveryBotIds: [alpha.id] })],
    submitted: { m1: { epoch: "ep", seq: 10 } },
    rows: [row(11, { type: "assistant_message", text: "Incomplete text", messageId: "a1" })],
  });
  await reconcileChats(h.deps);
  expect(h.appended).toHaveLength(1);
  expect(h.appended[0]?.input).toMatchObject({
    sender: { kind: "system" },
    reply: { agentId: "agent-a" },
    inReplyTo: "m1",
    deliveryBotIds: [alpha.id],
  });
  expect(h.appended[0]?.input.text).not.toContain("Incomplete text");
});

test("repairs confirmed ingress even when its reply landed and the newest trigger is unsubmitted", async () => {
  const record = chat();
  record.participants[0]!.deliveredSeq = 0;
  const h = harness({
    chats: [record],
    lines: [
      line(1, { deliveryBotIds: [alpha.id] }),
      line(2, {
        sender: { kind: "bot", botId: alpha.id },
        inReplyTo: "m1",
        reply: { agentId: "agent-a" },
      }),
      line(3, { deliveryBotIds: [alpha.id] }),
    ],
    submitted: { m1: { epoch: "ep", seq: 10 } },
  });
  await reconcileChats(h.deps);
  expect(h.repaired).toEqual([1]);
  expect(h.lookups.slice(0, 2)).toEqual(["m3", "m1"]);
  expect(h.appended[0]?.input.inReplyTo).toBe("m3");
});

test("repairs the newest positive receipt only, excluding own output and pre-reset history", async () => {
  const record = chat();
  record.participants[0] = { ...record.participants[0]!, deliveredSeq: 0, resetAt: "b" };
  const h = harness({
    chats: [record],
    running: ["agent-a"],
    lines: [
      line(1, { at: "a" }),
      line(2, { at: "c" }),
      line(3, { at: "d" }),
      line(4, { at: "e", sender: { kind: "bot", botId: alpha.id } }),
    ],
    submitted: {
      m1: { epoch: "ep", seq: 1 },
      m2: { epoch: "ep", seq: 2 },
      m4: { epoch: "ep", seq: 4 },
    },
  });
  await reconcileChats(h.deps);
  expect(h.lookups).toEqual(["m3", "m2"]);
  expect(h.repaired).toEqual([2]);
  expect(h.appended).toEqual([]);
});

test("a discussion reply to a later line answers the earlier delivery", async () => {
  const h = harness({
    lines: [
      line(1, { deliveryBotIds: [alpha.id, "bot_b"] }),
      line(2, { sender: { kind: "bot", botId: "bot_b" }, deliveryBotIds: [] }),
      line(3, {
        sender: { kind: "bot", botId: alpha.id },
        reply: { agentId: "agent-a" },
        inReplyTo: "m2",
        deliveryBotIds: [],
      }),
    ],
    submitted: { m2: { epoch: "ep", seq: 10 } },
  });
  await reconcileChats(h.deps);
  expect(h.appended).toEqual([]);
});
