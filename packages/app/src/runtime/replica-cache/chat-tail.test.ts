import { describe, expect, it } from "vitest";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import type { ChatMessage } from "@/clisbot/bots/data/contracts";
import { ReplicaCache } from ".";
import { CHAT_TAIL_MAX_LINES, type CachedChatTail } from "./chat-tail";
import { MemoryStorage } from "./testing";

const SERVER_ID = "host-1";

function createCache(storage: MemoryStorage): ReplicaCache {
  const cache = new ReplicaCache(storage, {
    clearLegacyCache: async () => undefined,
    offlineTails: true,
  });
  cache.setHosts([SERVER_ID]);
  return cache;
}

const chat: ChatPayload = {
  id: "chat-1",
  kind: "direct",
  title: "Release notes",
  participants: [
    {
      botId: "bot-1",
      slug: "writer",
      displayName: "Writer",
      addedAt: "2026-10-30T08:00:00.000Z",
      agentId: "agent-9",
    },
  ],
  rules: {},
  createdAt: "2026-10-30T08:00:00.000Z",
  updatedAt: "2026-10-30T08:00:00.000Z",
  lastMessageAt: null,
  archivedAt: null,
};

function line(seq: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `line-${seq}`,
    seq,
    at: "2026-10-30T08:01:00.000Z",
    sender: { kind: "bot", botId: "bot-1" },
    text: `line ${seq}`,
    ...overrides,
  };
}

async function roundTrip(tail: CachedChatTail) {
  const storage = new MemoryStorage();
  const writer = createCache(storage);
  await writer.readChatTail(SERVER_ID, "chat-1");
  writer.commitChatTail(SERVER_ID, "chat-1", tail);
  await writer.flush();
  const row = [...storage.rows.values()].find((candidate) => candidate.kind === "transcript");
  return {
    storage,
    payload: row?.payload ?? "",
    restored: await createCache(storage).readChatTail(SERVER_ID, "chat-1"),
  };
}

describe("chat transcript tails", () => {
  it("round-trips the chat record and the last 50 lines", async () => {
    const messages = Array.from({ length: 70 }, (_, index) => line(index + 1));

    const { restored } = await roundTrip({ chat, messages, hasOlder: false });

    expect(restored?.chat.id).toBe("chat-1");
    expect(restored?.messages).toHaveLength(CHAT_TAIL_MAX_LINES);
    expect(restored?.messages[0]).toEqual(line(21));
    expect(restored?.hasOlder).toBe(true);
  });

  it("replaces images with a count and never stores their bytes", async () => {
    const withImage = line(1, {
      images: [{ data: "BASE64-IMAGE-BYTES", mimeType: "image/png" }],
    });

    const { payload, restored } = await roundTrip({
      chat,
      messages: [withImage],
      hasOlder: false,
    });

    expect(payload).not.toContain("BASE64-IMAGE-BYTES");
    expect(restored?.messages[0]).toEqual({ ...line(1), offlineImageCount: 1 });
  });

  it("keeps the chat tail when the directory baseline is replaced", async () => {
    const { storage } = await roundTrip({ chat, messages: [line(1)], hasOlder: false });
    const cache = createCache(storage);

    cache.replaceDirectoryBaseline(SERVER_ID, {
      agents: new Map(),
      workspaces: new Map(),
      projects: new Map(),
    });
    await cache.flush();

    expect((await cache.readChatTail(SERVER_ID, "chat-1"))?.messages).toEqual([line(1)]);
  });
});
