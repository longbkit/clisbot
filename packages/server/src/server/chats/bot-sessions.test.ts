import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { BOT_ID_LABEL, CHAT_ID_LABEL } from "@clisbot/protocol/bots/labels";
import { createTestLogger } from "../../test-utils/test-logger.js";
import type { StoredAgentRecord } from "../agent/agent-storage.js";
import type { CreateAgentCommandInput } from "../agent/create-agent/create.js";
import { createAgentCommand } from "../agent/create-agent/create.js";
import type { ManagedAgent } from "../agent/agent-manager.js";
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
    discardAgent?: BotSessionsDependencies["discardAgent"];
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
      listAll: async () => Array.from(agents.values()),
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
    discardAgent: options.discardAgent,
  };
  return { store, chat, sessions: new BotSessions(deps), created, loaded, agents };
}

describe("BotSessions", () => {
  test("applies per-chat launch controls across a fresh session without changing the Bot", async () => {
    const { store, chat, sessions, created } = await harness();
    const launch = {
      provider: "codex",
      model: "chosen",
      modeId: "safe",
      thinkingOptionId: "high",
      featureValues: { web: false },
    };
    const configured = await store.update(chat.id, (record) => ({ ...record, launch }));
    await sessions.resolve(configured, bot);
    expect(created[0]).toMatchObject({
      provider: "codex/chosen",
      mode: "safe",
      thinking: "high",
      providerOptions: { web: false },
    });
    expect(created[0]).not.toHaveProperty("features");
    expect(bot.launch.model).not.toBe("chosen");
  });

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

describe("BotSessions.fork", () => {
  const launch = { provider: "claude", model: "sonnet" };
  const attachment = {
    type: "text" as const,
    mimeType: "text/plain",
    contextKind: "chat_history" as const,
    text: "earlier",
  };
  const start = { title: "Research sync", systemPrompt: undefined };

  test("records the launch, the new session and the carry in one write; a scan adopts it", async () => {
    const old = agentRecord("agent-old");
    const { store, chat, sessions } = await harness({ agents: [old] });
    await store.setParticipantAgent(chat.id, bot.id, "agent-old");
    const forked = await sessions.fork(
      chat,
      bot,
      launch,
      start,
      { sourceAgentId: "agent-old", attachment },
      "agent-old",
    );
    const stored = await store.require(chat.id);
    expect(stored.launch).toEqual(launch);
    expect(stored.participants[0]).toMatchObject({ agentId: forked.agentId });
    expect(store.forkCarry(chat.id, bot.id)).toMatchObject({
      sourceAgentId: "agent-old",
      previousAgentId: "agent-old",
      agentId: forked.agentId,
      attachment,
    });
    // A lost cache is repaired to the fork, never back to the old session.
    await store.setParticipantAgent(chat.id, bot.id, null);
    const resolved = await sessions.resolve(await store.require(chat.id), bot);
    expect(resolved).toMatchObject({ agentId: forked.agentId, created: false });
  });

  test("a session that cannot be recorded is archived and the old one stays", async () => {
    const old = agentRecord("agent-old");
    const discarded: string[] = [];
    const { store, chat, sessions } = await harness({
      agents: [old],
      discardAgent: async (agentId) => {
        discarded.push(agentId);
      },
    });
    await store.setParticipantAgent(chat.id, bot.id, "agent-old");
    const failing = Object.assign(Object.create(Object.getPrototypeOf(store)), store, {
      forkParticipantSession: async () => {
        throw new Error("disk full");
      },
    });
    const broken = new BotSessions({
      agentStorage: { get: async () => null, listAll: async () => [] },
      store: failing,
      createAgent: async () => ({ snapshot: { id: "agent-orphan" } }) as never,
      ensureLoaded: async () => undefined,
      discardAgent: async (agentId) => {
        discarded.push(agentId);
      },
    });
    await expect(broken.fork(chat, bot, launch, start, null, "agent-old")).rejects.toThrow(
      "disk full",
    );
    expect(discarded).toEqual(["agent-orphan"]);
    expect((await store.require(chat.id)).participants[0]?.agentId).toBe("agent-old");
    expect((await store.require(chat.id)).launch).toBeUndefined();
    void sessions;
  });

  test("a launch that cannot start changes nothing", async () => {
    const { store, chat } = await harness();
    await store.setParticipantAgent(chat.id, bot.id, "agent-old");
    const sessions = new BotSessions({
      agentStorage: { get: async () => null, listAll: async () => [] },
      store,
      createAgent: async () => {
        throw new Error("claude is not installed");
      },
      ensureLoaded: async () => undefined,
    });
    await expect(sessions.fork(chat, bot, launch, start, null, "agent-old")).rejects.toThrow(
      "not installed",
    );
    const stored = await store.require(chat.id);
    expect(stored.launch).toBeUndefined();
    expect(stored.participants[0]?.agentId).toBe("agent-old");
  });

  test("a carry counts only while its session is bound: cleared by its own key, gone after /new", async () => {
    const { store, chat } = await harness();
    const resetAt = new Date().toISOString();
    await store.forkParticipantSession(chat.id, bot.id, {
      launch,
      agentId: "agent-new",
      resetAt,
      carry: { sourceAgentId: "agent-old", previousAgentId: "agent-old", attachment },
    });
    await store.clearForkCarry(chat.id, "agent-other");
    expect(store.forkCarry(chat.id, bot.id)).toMatchObject({ agentId: "agent-new" });
    await store.clearForkCarry(chat.id, "agent-new");
    expect(store.forkCarry(chat.id, bot.id)).toBeNull();

    // Same resetAt as before (a frozen clock): the binding, not the time, decides.
    await store.forkParticipantSession(chat.id, bot.id, {
      launch,
      agentId: "agent-newer",
      resetAt,
      carry: { sourceAgentId: "agent-old", previousAgentId: "agent-new", attachment },
    });
    expect(store.forkCarry(chat.id, bot.id)).toMatchObject({ agentId: "agent-newer" });
    await store.resetParticipantSession(chat.id, bot.id);
    expect(store.forkCarry(chat.id, bot.id)).toBeNull();
    // Re-binding the same session id cannot happen through a fork; even a manual cache write
    // only finds a carry the file still holds for exactly that session and Bot.
    const reopened = new ChatStore(store.rootDir, createTestLogger());
    await reopened.load();
    expect(reopened.forkCarry(chat.id, bot.id)).toBeNull();
  });
});

// A Bot's launch record keeps `featureValues` (disk, wire, current Bot form); agent creation takes
// `providerOptions`. These run the real create command so a dropped value shows up in the config
// the agent manager receives, not only in what BotSessions hands over.
describe("BotSessions launch options through the real create command", () => {
  async function realCreate(root: string) {
    const created: Array<{ providerOptions?: unknown }> = [];
    const createAgent = vi.fn(async (config: { providerOptions?: unknown }) => {
      created.push(config);
      return {
        id: `agent-real-${created.length}`,
        provider: "codex",
        cwd: "/bots/alpha",
      } as ManagedAgent;
    });
    const agents = new Map<string, StoredAgentRecord>();
    const command = (input: CreateAgentCommandInput) =>
      createAgentCommand(
        {
          agentManager: {
            createAgent,
            getAgent: vi.fn((id: string) => ({ id, provider: "codex", runtimeInfo: null })),
          } as unknown as Parameters<typeof createAgentCommand>[0]["agentManager"],
          agentStorage: {} as Parameters<typeof createAgentCommand>[0]["agentStorage"],
          logger: createTestLogger(),
          providerSnapshotManager: {
            resolveCreateConfig: vi.fn(async () => ({})),
          } as unknown as Parameters<typeof createAgentCommand>[0]["providerSnapshotManager"],
        },
        input,
      ).then((result) => {
        const id = result.snapshot.id;
        agents.set(id, agentRecord(id, { createdAt: new Date().toISOString() }));
        return result;
      });
    const sessions = (store: ChatStore) =>
      new BotSessions({
        agentStorage: {
          get: async (id) => agents.get(id) ?? null,
          listAll: async () => Array.from(agents.values()),
        },
        store,
        createAgent: command,
        ensureLoaded: async () => {},
      });
    return { created, sessions, store: () => new ChatStore(root, createTestLogger()) };
  }

  test("a saved Bot's launch values reach the agent config", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bot-sessions-real-"));
    roots.push(root);
    const { created, sessions, store } = await realCreate(root);
    const savedBot: ChatBot = {
      ...bot,
      launch: {
        ...bot.launch,
        featureValues: { mockStreamingAssistantResponse: "F03_GROUP_PREFIX" },
      },
    };
    const chats = store();
    const chat = await chats.create({ id: "cht_1", title: "Saved", botIds: [savedBot.id] });
    await sessions(chats).resolve(chat, savedBot);
    expect(created[0]?.providerOptions).toEqual({
      mockStreamingAssistantResponse: "F03_GROUP_PREFIX",
    });
  });

  test("a chat launch saved by an earlier version survives a restart and /new", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bot-sessions-real-"));
    roots.push(root);
    const { created, sessions, store } = await realCreate(root);
    const first = store();
    const chat = await first.create({ id: "cht_1", title: "Saved", botIds: [bot.id] });
    // Write the launch straight into chat.json, as a 2.2.x daemon stored it.
    const file = path.join(root, "cht_1", "chat.json");
    const record = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    record["launch"] = { ...bot.launch, featureValues: { web: false, auto_accept: true } };
    await fs.writeFile(file, JSON.stringify(record));

    // Restart: a fresh store reads the record from disk.
    const reloaded = store();
    await reloaded.load();
    const stored = await reloaded.require(chat.id);
    const service = sessions(reloaded);
    await service.resolve(stored, bot);
    expect(created[0]?.providerOptions).toEqual({ web: false, auto_accept: true });

    // Reopen: /new forgets the session; the next delivery launches with the same options.
    await reloaded.resetParticipantSession(chat.id, bot.id);
    await service.resolve(await reloaded.require(chat.id), bot);
    expect(created).toHaveLength(2);
    expect(created[1]?.providerOptions).toEqual({ web: false, auto_accept: true });
  });
});
