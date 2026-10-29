import { beforeEach, expect, it, vi } from "vitest";

const files = vi.hoisted(() => ({ bytes: 400, cleared: 0 }));
vi.mock("@/stores/downloaded-files", () => ({
  downloadedFilesBytes: () => files.bytes,
  clearDownloadedFiles: () => {
    files.cleared += 1;
    files.bytes = 0;
  },
}));

import { transcriptKey, useTranscriptStore } from "@/clisbot/bots/data/transcript-store";
import { ReplicaCache } from "@/runtime/replica-cache";
import { MemoryStorage } from "@/runtime/replica-cache/testing";
import { clearOfflineData, clearOfflineSources, offlineDataBytes } from "./clear";

const chat = {
  id: "chat-1",
  title: null,
  participants: [],
  rules: {},
  createdAt: "now",
  updatedAt: "now",
  lastMessageAt: null,
  archivedAt: null,
};

async function seeded() {
  const storage = new MemoryStorage();
  const cache = new ReplicaCache(storage, {
    clearLegacyCache: async () => undefined,
    offlineTails: true,
  });
  cache.setHosts(["host-a", "host-b"]);
  for (const serverId of ["host-a", "host-b"]) {
    await cache.readChatTail(serverId, "chat-1");
    cache.commitChatTail(serverId, "chat-1", { chat, messages: [], hasOlder: false });
    useTranscriptStore
      .getState()
      .replacePage(transcriptKey(`${serverId}@1:1`, "chat-1"), { messages: [], hasOlder: false });
  }
  await cache.flush();
  return { storage, cache };
}

beforeEach(() => {
  files.bytes = 400;
  files.cleared = 0;
  useTranscriptStore.setState({ transcripts: {}, reads: {} });
});

it("forgets a signed-out source's rows and chats, and keeps every other source", async () => {
  const { storage, cache } = await seeded();

  await clearOfflineSources(cache, ["host-a"]);

  expect([...storage.rows.keys()]).toEqual(["host-b:transcript:chat-1"]);
  expect(Object.keys(useTranscriptStore.getState().transcripts)).toEqual(["host-b@1:1:chat-1"]);
  expect(files.cleared).toBe(0);
});

it("measures and clears the whole offline cache, downloaded files included", async () => {
  const { storage, cache } = await seeded();
  const rowBytes = [...storage.rows.values()].reduce((sum, row) => sum + row.payload.length, 0);
  expect(await offlineDataBytes(cache)).toBe(rowBytes + 400);

  await clearOfflineData(cache);

  expect(storage.rows.size).toBe(0);
  expect(useTranscriptStore.getState().transcripts).toEqual({});
  expect(files.cleared).toBe(1);
  expect(await offlineDataBytes(cache)).toBe(0);
});
