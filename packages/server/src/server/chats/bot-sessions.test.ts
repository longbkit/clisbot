import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { BOT_ID_LABEL, CHAT_ID_LABEL } from "@clisbot/protocol/bots/labels";
import { createTestLogger } from "../../test-utils/test-logger.js";
import type { StoredAgentRecord } from "../agent/agent-storage.js";
import type { CreateAgentCommandInput } from "../agent/create-agent/create.js";
import { BotSessions, type BotSessionsDependencies } from "./bot-sessions.js";
import type { ChatBot } from "./chat-record.js";
import { ChatStore } from "./chat-store.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const bot: ChatBot = {
  id: "bot_a",
  slug: "alpha",
  displayName: "Alpha",
  workspaceId: "wks_alpha",
  cwd: "/bots/alpha",
  launch: { provider: "codex", model: "gpt-5", modeId: "auto", thinkingOptionId: "high" },
};

function agentRecord(id: string, overrides: Partial<StoredAgentRecord> = {}): StoredAgentRecord {
  return {
    id,
    provider: "codex",
    cwd: bot.cwd,
    workspaceId: bot.workspaceId,
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
    labels: { [BOT_ID_LABEL]: bot.id, [CHAT_ID_LABEL]: "cht_1" },
    lastStatus: "idle",
    config: {},
    ...overrides,
  } as StoredAgentRecord;
}

async function harness(
  options: {
    agents?: StoredAgentRecord[];
    failsToLoad?: string[];
    moveHeartbeats?: BotSessionsDependencies["moveHeartbeats"];
  } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bot-sessions-"));
  roots.push(root);
  const store = new ChatStore(root, createTestLogger());
  const chat = await store.create({ id: "cht_1", title: "Research sync", botIds: [bot.id] });
  const agents = new Map((options.agents ?? []).map((record) => [record.id, record]));
  const created: CreateAgentCommandInput[] = [];
  const loaded: string[] = [];
  let counter = 0;
  const deps: BotSessionsDependencies = {
    agentStorage: {
      get: async (id) => agents.get(id) ?? null,
      list: async () => Array.from(agents.values()),
    },
    store,
    createAgent: async (input) => {
      created.push(input);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const id = `agent-new-${++counter}`;
      agents.set(id, agentRecord(id, { createdAt: new Date().toISOString() }));
      return { snapshot: { id } } as Awaited<ReturnType<BotSessionsDependencies["createAgent"]>>;
    },
    ensureLoaded: async (id) => {
      loaded.push(id);
      if (options.failsToLoad?.includes(id)) throw new Error(`cannot resume ${id}`);
    },
    moveHeartbeats: options.moveHeartbeats,
  };
  return { store, chat, sessions: new BotSessions(deps), created, loaded };
}

describe("BotSessions", () => {
  test("creates a labelled session in the bot's workspace with its launch defaults, once per pair", async () => {
    const { store, chat, sessions, created } = await harness();
    const [first, second] = await Promise.all([
      sessions.resolve(chat, bot),
      sessions.resolve(chat, bot, "Find the spec"),
    ]);
    expect(first).toEqual({ agentId: "agent-new-1", created: true, replaced: null });
    expect(second).toEqual({ agentId: "agent-new-1", created: false, replaced: null });
    expect(created).toEqual([
      {
        kind: "mcp",
        provider: "codex/gpt-5",
        title: "Research sync",
        mode: "auto",
        thinking: "high",
        cwd: "/bots/alpha",
        workspaceId: "wks_alpha",
        labels: { [BOT_ID_LABEL]: "bot_a", [CHAT_ID_LABEL]: "cht_1" },
        background: true,
        notifyOnFinish: false,
        promptFailure: "throw",
      },
    ]);
    expect((await store.require("cht_1")).participants[0]?.agentId).toBe("agent-new-1");
  });

  test("reuses the cached agent when its labels match, and resumes it", async () => {
    const { store, chat, sessions, created, loaded } = await harness({
      agents: [agentRecord("agent-cached")],
    });
    await store.setParticipantAgent("cht_1", bot.id, "agent-cached");
    expect(await sessions.resolve(chat, bot)).toEqual({
      agentId: "agent-cached",
      created: false,
      replaced: null,
    });
    expect(created).toEqual([]);
    expect(loaded).toEqual(["agent-cached"]);
  });

  test("adopts the newest labelled agent when the cache is stale, and writes it back", async () => {
    const { store, chat, sessions, created } = await harness({
      agents: [
        agentRecord("agent-old", { createdAt: "2026-09-20T00:00:00.000Z" }),
        agentRecord("agent-newer", { createdAt: "2026-09-25T00:00:00.000Z" }),
        agentRecord("agent-other-chat", {
          createdAt: "2026-09-26T00:00:00.000Z",
          labels: { [BOT_ID_LABEL]: bot.id, [CHAT_ID_LABEL]: "cht_2" },
        }),
        agentRecord("agent-archived", {
          createdAt: "2026-09-26T00:00:00.000Z",
          archivedAt: "2026-09-26T01:00:00.000Z",
        }),
      ],
    });
    await store.setParticipantAgent("cht_1", bot.id, "agent-gone");
    expect(await sessions.resolve(chat, bot)).toEqual({
      agentId: "agent-newer",
      created: false,
      replaced: null,
    });
    expect(created).toEqual([]);
    expect((await store.require("cht_1")).participants[0]?.agentId).toBe("agent-newer");
  });

  test("replaces a cached session that was archived from the cowork view", async () => {
    const { store, chat, sessions } = await harness({
      agents: [agentRecord("agent-cached", { archivedAt: "2026-09-26T01:00:00.000Z" })],
    });
    await store.setParticipantAgent("cht_1", bot.id, "agent-cached");
    expect(await sessions.resolve(chat, bot)).toEqual({
      agentId: "agent-new-1",
      created: true,
      replaced: "archived",
    });
  });

  test("replaces a session that cannot resume", async () => {
    const { store, chat, sessions, loaded } = await harness({
      agents: [agentRecord("agent-cached")],
      failsToLoad: ["agent-cached"],
    });
    await store.setParticipantAgent("cht_1", bot.id, "agent-cached");
    expect(await sessions.resolve(chat, bot)).toEqual({
      agentId: "agent-new-1",
      created: true,
      replaced: "could_not_resume",
    });
    expect(loaded).toEqual(["agent-cached"]);
    expect((await store.require("cht_1")).participants[0]?.agentId).toBe("agent-new-1");
  });

  test("/new forgets the pair's session so the next delivery creates a fresh one", async () => {
    const { store, chat, sessions } = await harness();
    await sessions.resolve(chat, bot);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await sessions.reset("cht_1", bot.id);
    expect((await store.require("cht_1")).participants[0]?.agentId).toBeNull();
    // The old agent keeps its labels (history), so the scan would find it again;
    // `resetAt` is what keeps a reset from being undone by the crash fallback.
    expect(await sessions.resolve(chat, bot)).toEqual({
      agentId: "agent-new-2",
      created: true,
      replaced: null,
    });
  });

  test("a fresh session takes over the heartbeats of the pair's earlier sessions", async () => {
    const moves: Array<{ from: readonly string[]; to: string }> = [];
    const { chat, sessions } = await harness({
      moveHeartbeats: async (from, to) => {
        moves.push({ from, to });
      },
    });
    await sessions.resolve(chat, bot);
    expect(moves).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await sessions.reset("cht_1", bot.id);
    await sessions.resolve(chat, bot);
    expect(moves).toEqual([{ from: ["agent-new-1"], to: "agent-new-2" }]);
  });
});
