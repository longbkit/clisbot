import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { ChannelResultStore } from "../src/channels/results/result-store.ts";
import { tempPath } from "./support/api-channel-helpers.ts";

describe("channel result store", () => {
  test("persists result records and reloads them from disk", async () => {
    const path = tempPath("results.json");
    const firstStore = new ChannelResultStore(path);
    await firstStore.createResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message-created-123",
      surfaceId: "3:970",
      surfaceKind: "dm",
    });
    await firstStore.appendOutput({
      channel: "api",
      botId: "chatwoot",
      eventId: "message-created-123",
      kind: "progress",
      text: "Working",
    });
    await firstStore.appendOutput({
      channel: "api",
      botId: "chatwoot",
      eventId: "message-created-123",
      kind: "final",
      text: "Done",
      render: "markdown",
    });

    const secondStore = new ChannelResultStore(path);
    const result = await secondStore.getResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message-created-123",
    });

    expect(result?.status).toBe("completed");
    expect(result?.progress).toHaveLength(1);
    expect(result?.result?.text).toBe("Done");
    expect(result?.result?.render).toBe("markdown");
  });

  test("reloads external writes from another process view", async () => {
    const path = tempPath("results.json");
    const runtimeStore = new ChannelResultStore(path);
    const cliStore = new ChannelResultStore(path);
    await cliStore.createResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message-created-123",
    });

    expect((await runtimeStore.getResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message-created-123",
    }))?.result).toBeNull();

    await cliStore.appendOutput({
      channel: "api",
      botId: "chatwoot",
      eventId: "message-created-123",
      kind: "final",
      text: "Updated by CLI",
    });

    expect((await runtimeStore.getResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message-created-123",
    }))?.result?.text).toBe("Updated by CLI");
  });

  test("serializes concurrent independent-store writes without losing records", async () => {
    const path = tempPath("results.json");
    const eventIds = Array.from({ length: 24 }, (_, index) => `message-created-${index}`);

    await Promise.all(eventIds.map((eventId) => {
      const store = new ChannelResultStore(path);
      return store.createResult({
        channel: "api",
        botId: "chatwoot",
        eventId,
        surfaceId: `conversation-${eventId}`,
      });
    }));

    await Promise.all(eventIds.map((eventId) => {
      const store = new ChannelResultStore(path);
      return store.appendOutput({
        channel: "api",
        botId: "chatwoot",
        eventId,
        kind: "final",
        text: `Done ${eventId}`,
      });
    }));

    const verifier = new ChannelResultStore(path);
    for (const eventId of eventIds) {
      const result = await verifier.getResult({
        channel: "api",
        botId: "chatwoot",
        eventId,
      });
      expect(result?.status).toBe("completed");
      expect(result?.result?.text).toBe(`Done ${eventId}`);
    }
  });

  test("keeps concurrent result readers stable while independent stores append outputs", async () => {
    const path = tempPath("results.json");
    const eventIds = Array.from({ length: 16 }, (_, index) => `message-created-${index}`);
    const setupStore = new ChannelResultStore(path);

    for (const eventId of eventIds) {
      await setupStore.createResult({
        channel: "api",
        botId: "chatwoot",
        eventId,
      });
    }

    const writes = Promise.all(eventIds.map((eventId) => {
      const store = new ChannelResultStore(path);
      return store.appendOutput({
        channel: "api",
        botId: "chatwoot",
        eventId,
        kind: "final",
        text: `Done ${eventId}`,
      });
    }));
    const reads = Promise.all(eventIds.flatMap((eventId) =>
      Array.from({ length: 3 }, async () => {
        await Bun.sleep(1);
        const store = new ChannelResultStore(path);
        const result = await store.getResult({
          channel: "api",
          botId: "chatwoot",
          eventId,
        });
        expect(result?.eventId).toBe(eventId);
      })
    ));

    await Promise.all([writes, reads]);
    const verifier = new ChannelResultStore(path);
    for (const eventId of eventIds) {
      expect((await verifier.getResult({
        channel: "api",
        botId: "chatwoot",
        eventId,
      }))?.result?.text).toBe(`Done ${eventId}`);
    }
  });

  test("marks records expired after retention and prunes records past grace", async () => {
    const path = tempPath("results.json");
    const expiringStore = new ChannelResultStore(path, 1);
    await expiringStore.createResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message-created-123",
    });
    await Bun.sleep(5);

    expect((await expiringStore.getResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message-created-123",
    }))?.status).toBe("expired");

    await writeFile(path, JSON.stringify({
      results: {
        "api:chatwoot:old": {
          channel: "api",
          botId: "chatwoot",
          eventId: "old",
          status: "completed",
          progress: [],
          result: null,
          error: null,
          expiresAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      surfaces: {},
    }));

    const pruningStore = new ChannelResultStore(path);
    expect(await pruningStore.getResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "old",
    })).toBeNull();
  });
});
