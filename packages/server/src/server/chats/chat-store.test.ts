import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import {
  CHAT_RULE_DEFAULTS,
  StoredChatSchema,
  chatPayload,
  limitValue,
  resolveChatRules,
} from "./chat-record.js";
import { ChatStore } from "./chat-store.js";
import { KeyedSerialQueue } from "./keyed-queue.js";

const roots: string[] = [];
async function temporary(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chat-store-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function clock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 8, 26, 0, 0, tick++)).toISOString();
}

describe("chat record", () => {
  test("applies the D9 defaults to what the creator left unset", () => {
    expect(resolveChatRules(undefined)).toEqual(CHAT_RULE_DEFAULTS);
    const resolved = resolveChatRules({
      interaction: { requireMention: true },
      limits: { maxInputCharacters: "off", maxRuntimeSeconds: 60 },
    });
    expect(resolved).toEqual({
      interaction: { requireMention: true, whenBusy: "steer" },
      hops: { max: 3 },
      rounds: { max: 5 },
      room: { instructions: null },
      context: { maxMessages: 20 },
      limits: { maxInputCharacters: "off", maxRuntimeSeconds: 60 },
      tools: { off: [] },
    });
    expect(limitValue(resolved, "maxInputCharacters")).toBeNull();
    expect(limitValue(resolved, "maxRuntimeSeconds")).toBe(60);
    expect(limitValue(CHAT_RULE_DEFAULTS, "maxInputCharacters")).toBe(8000);
  });

  test("rejects an unknown key anywhere in the record", () => {
    const valid = {
      id: "cht_1",
      title: null,
      participants: [
        { botId: "bot_a", addedAt: "t", agentId: null, resetAt: null, deliveredSeq: 0 },
      ],
      rules: { hops: { max: 1 } },
      createdAt: "t",
      updatedAt: "t",
      lastMessageAt: null,
      archivedAt: null,
    };
    expect(StoredChatSchema.safeParse(valid).success).toBe(true);
    expect(StoredChatSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(
      StoredChatSchema.safeParse({ ...valid, rules: { hops: { max: 1, x: 1 } } }).success,
    ).toBe(false);
    expect(
      StoredChatSchema.safeParse({
        ...valid,
        participants: [{ ...valid.participants[0], status: "running" }],
      }).success,
    ).toBe(false);
  });
});

describe("ChatStore", () => {
  test("creates chat.json under chats/{id}, lists it after a rescan, and skips damaged records", async () => {
    const root = await temporary();
    const store = new ChatStore(root, createTestLogger(), clock());
    const chat = await store.create({
      id: "cht_1",
      title: "Research sync",
      botIds: ["bot_a", "bot_b", "bot_a"],
      createdBy: { kind: "user", id: "usr_1", displayName: "Long" },
    });
    expect(chat.participants.map((entry) => entry.botId)).toEqual(["bot_a", "bot_b"]);
    expect(chat.participants[0]).toEqual({
      botId: "bot_a",
      addedAt: "2026-09-26T00:00:00.000Z",
      agentId: null,
      resetAt: null,
      deliveredSeq: 0,
    });
    const file = path.join(root, "cht_1", "chat.json");
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual(chat);
    await fs.mkdir(path.join(root, "cht_bad"));
    await fs.writeFile(path.join(root, "cht_bad", "chat.json"), JSON.stringify({ id: "cht_bad" }));

    await fs.mkdir(path.join(root, "cht_malformed"));
    await fs.writeFile(path.join(root, "cht_malformed", "chat.json"), "{truncated");
    const reopened = new ChatStore(root, createTestLogger(), clock());
    expect((await reopened.list()).map((entry) => entry.id)).toEqual(["cht_1"]);
    expect(await reopened.get("cht_1")).toEqual(chat);
    await expect(reopened.require("cht_bad")).rejects.toThrow("Chat cht_bad not found");
    await expect(store.create({ id: "cht_1", botIds: [] })).rejects.toThrow("already exists");
  });

  test("refuses an id that could leave the chats directory", async () => {
    const store = new ChatStore(await temporary(), createTestLogger());
    await expect(store.create({ id: "../escape", botIds: [] })).rejects.toThrow(
      "Invalid session id",
    );
  });

  test("mutations under one chat run in order and publish each written record", async () => {
    const store = new ChatStore(await temporary(), createTestLogger(), clock());
    const published: string[] = [];
    store.subscribe((chat) => published.push(`${chat.updatedAt}:${chat.title}`));
    await store.create({ id: "cht_1", botIds: ["bot_a"] });
    await Promise.all([
      store.update("cht_1", (chat) => ({ ...chat, title: "one" })),
      store.update("cht_1", (chat) => ({ ...chat, title: `${chat.title}-two` })),
      store.update("cht_1", (chat) => chat),
    ]);
    expect((await store.require("cht_1")).title).toBe("one-two");
    expect(published).toEqual([
      "2026-09-26T00:00:00.000Z:null",
      "2026-09-26T00:00:01.000Z:one",
      "2026-09-26T00:00:02.000Z:one-two",
    ]);
  });

  test("markDelivered is monotonic and participant edits are idempotent", async () => {
    const store = new ChatStore(await temporary(), createTestLogger(), clock());
    await store.create({ id: "cht_1", botIds: ["bot_a"] });
    await store.markDelivered("cht_1", "bot_a", 5);
    await store.markDelivered("cht_1", "bot_a", 3);
    await store.markDelivered("cht_1", "bot_missing", 9);
    expect((await store.require("cht_1")).participants).toEqual([
      {
        botId: "bot_a",
        addedAt: "2026-09-26T00:00:00.000Z",
        agentId: null,
        resetAt: null,
        deliveredSeq: 5,
      },
    ]);
    const withAgent = await store.setParticipantAgent("cht_1", "bot_a", "agent-1");
    expect(withAgent.participants[0]?.agentId).toBe("agent-1");
    const reset = await store.resetParticipantSession("cht_1", "bot_a");
    expect(reset.participants[0]).toMatchObject({ agentId: null, resetAt: reset.updatedAt });
    const added = await store.addParticipant("cht_1", "bot_b");
    const addedAgain = await store.addParticipant("cht_1", "bot_b");
    expect(addedAgain).toBe(added);
    expect(added.participants.map((entry) => entry.botId)).toEqual(["bot_a", "bot_b"]);
    const removed = await store.removeParticipant("cht_1", "bot_a");
    expect(removed.participants.map((entry) => entry.botId)).toEqual(["bot_b"]);
    const archived = await store.archive("cht_1");
    expect(archived.archivedAt).toBe(archived.updatedAt);
    expect(await store.archive("cht_1")).toBe(archived);
  });

  test("the payload drops deliveredSeq, names the bot, and carries resolved rules", async () => {
    const store = new ChatStore(await temporary(), createTestLogger(), clock());
    const chat = await store.create({
      id: "cht_1",
      botIds: ["bot_a"],
      rules: { hops: { max: 1 } },
    });
    await store.markDelivered("cht_1", "bot_a", 2);
    const payload = chatPayload(await store.require("cht_1"), (botId) =>
      botId === "bot_a" ? { slug: "alpha", displayName: "Alpha" } : null,
    );
    expect(payload).toEqual({
      id: "cht_1",
      kind: "direct",
      title: null,
      participants: [
        {
          botId: "bot_a",
          slug: "alpha",
          displayName: "Alpha",
          addedAt: chat.createdAt,
          agentId: null,
        },
      ],
      rules: { ...CHAT_RULE_DEFAULTS, hops: { max: 1 } },
      createdAt: chat.createdAt,
      updatedAt: "2026-09-26T00:00:01.000Z",
      lastMessageAt: null,
      archivedAt: null,
    });
  });
});

describe("KeyedSerialQueue", () => {
  test("serializes one key, runs keys in parallel, and a failure never blocks the next", async () => {
    const queue = new KeyedSerialQueue();
    const order: string[] = [];
    const slow = queue.run("a", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("a1");
    });
    const failing = queue.run("a", async () => {
      order.push("a2");
      throw new Error("boom");
    });
    const after = queue.run("a", async () => order.push("a3"));
    const other = queue.run("b", async () => order.push("b1"));
    await expect(failing).rejects.toThrow("boom");
    await Promise.all([slow, after, other]);
    expect(order).toEqual(["b1", "a1", "a2", "a3"]);
    await queue.idle();
  });
});

test("completion receipts survive restart and /new clears their session scope", async () => {
  const root = await temporary();
  const store = new ChatStore(root, createTestLogger());
  await store.create({ id: "cht_receipt", botIds: ["bot_a"] });
  await store.setParticipantAgent("cht_receipt", "bot_a", "agent-a");
  const receipt = {
    agentId: "agent-a",
    turnId: "turn-a",
    messageIds: ["m1"],
    lastRow: { epoch: "ep", seq: 3 },
  };
  await store.recordCompletedTurn("cht_receipt", "bot_a", receipt);
  const restarted = new ChatStore(root, createTestLogger());
  expect((await restarted.require("cht_receipt")).participants[0]?.completedTurn).toEqual(receipt);
  await restarted.resetParticipantSession("cht_receipt", "bot_a");
  await restarted.recordCompletedTurn("cht_receipt", "bot_a", receipt);
  expect((await restarted.require("cht_receipt")).participants[0]?.completedTurn).toBeNull();
});

test("Chat kind survives group membership changes and restart", async () => {
  const root = await temporary();
  const store = new ChatStore(root, createTestLogger());
  const direct = await store.create({ botIds: ["a"] });
  expect(direct.kind).toBe("direct");
  await store.addParticipant(direct.id, "b");
  await store.removeParticipant(direct.id, "b");
  expect((await store.get(direct.id))?.kind).toBe("group");
  const singleGroup = await store.create({ botIds: ["a"], kind: "group" });
  expect(singleGroup.kind).toBe("group");
  const reopened = new ChatStore(root, createTestLogger());
  expect((await reopened.get(direct.id))?.kind).toBe("group");
  expect((await reopened.get(singleGroup.id))?.kind).toBe("group");
});

test("group settings persist without replacing internal limits or session bindings", async () => {
  const root = await temporary();
  const logger = createTestLogger();
  const store = new ChatStore(root, logger);
  const chat = await store.create({
    id: "group-settings",
    kind: "group",
    botIds: ["a", "b"],
    title: "Before",
    rules: {
      interaction: { whenBusy: "queue" },
      hops: { max: 5 },
      limits: { maxInputCharacters: 9000 },
    },
  });
  const updated = await store.updateSettings(chat.id, {
    title: "  Launch  ",
    requireMention: true,
  });
  expect(updated.title).toBe("Launch");
  expect(updated.rules).toEqual({
    interaction: { whenBusy: "queue", requireMention: true },
    hops: { max: 5 },
    limits: { maxInputCharacters: 9000 },
  });
  expect(updated.participants).toEqual(chat.participants);
  expect(await new ChatStore(root, logger).get(chat.id)).toEqual(updated);
  const withRoom = await store.updateSettings(chat.id, { roomInstructions: "  Be brief.  " });
  expect(withRoom.rules.room).toEqual({ instructions: "Be brief." });
  expect(withRoom.rules.interaction).toEqual(updated.rules.interaction);
  expect(withRoom.title).toBe("Launch");
  expect((await store.updateSettings(chat.id, { roundsMax: 3 })).rules.rounds).toEqual({ max: 3 });
  expect(() => store.updateSettings(chat.id, { roundsMax: 21 })).toThrow();
  const cleared = await store.updateSettings(chat.id, { roomInstructions: " " });
  expect(cleared.rules.room).toEqual({ instructions: null });
  expect((await store.updateSettings(chat.id, { title: " " })).title).toBeNull();
  expect(() => store.updateSettings(chat.id, { title: "x".repeat(257) })).toThrow();
});

test("a chat keeps its tools off list, direct chats included, and nothing else changes", async () => {
  const root = await temporary();
  const store = new ChatStore(root, createTestLogger());
  await store.create({ id: "direct-tools", kind: "direct", botIds: ["a"], title: "Before" });
  const updated = await store.updateSettings("direct-tools", {
    toolsOff: ["gmail", "tools:browser", "gmail"],
  });
  expect(updated.rules.tools).toEqual({ off: ["gmail", "tools:browser"] });
  expect(updated.title).toBe("Before");
  expect(await new ChatStore(root, createTestLogger()).get("direct-tools")).toEqual(updated);
  // An empty list leaves no key, so an older daemon can still read the Chat.
  expect(
    (await store.updateSettings("direct-tools", { toolsOff: [] })).rules.tools,
  ).toBeUndefined();
});

test("group settings reject direct and archived chats and unknown rule fields", async () => {
  const store = new ChatStore(await temporary(), createTestLogger());
  await store.create({ id: "direct-settings", kind: "direct", botIds: ["a"] });
  await expect(store.updateSettings("direct-settings", { title: "rename" })).rejects.toThrow(
    "Only group",
  );
  await store.create({ id: "archived-settings", kind: "group", botIds: ["a"] });
  await store.update("archived-settings", (chat) => ({ ...chat, archivedAt: "now" }));
  await expect(store.updateSettings("archived-settings", { requireMention: true })).rejects.toThrow(
    "Archived",
  );
  expect(() => store.updateSettings("archived-settings", { hops: { max: 0 } } as never)).toThrow();
});
