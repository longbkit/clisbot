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
      eventId: "message_created:123",
      surfaceId: "3:970",
      surfaceKind: "dm",
    });
    await firstStore.appendOutput({
      channel: "api",
      botId: "chatwoot",
      eventId: "message_created:123",
      kind: "progress",
      text: "Working",
    });
    await firstStore.appendOutput({
      channel: "api",
      botId: "chatwoot",
      eventId: "message_created:123",
      kind: "final",
      text: "Done",
      render: "markdown",
    });

    const secondStore = new ChannelResultStore(path);
    const result = await secondStore.getResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message_created:123",
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
      eventId: "message_created:123",
    });

    expect((await runtimeStore.getResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message_created:123",
    }))?.result).toBeNull();

    await cliStore.appendOutput({
      channel: "api",
      botId: "chatwoot",
      eventId: "message_created:123",
      kind: "final",
      text: "Updated by CLI",
    });

    expect((await runtimeStore.getResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message_created:123",
    }))?.result?.text).toBe("Updated by CLI");
  });

  test("marks records expired after retention and prunes records past grace", async () => {
    const path = tempPath("results.json");
    const expiringStore = new ChannelResultStore(path, 1);
    await expiringStore.createResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message_created:123",
    });
    await Bun.sleep(5);

    expect((await expiringStore.getResult({
      channel: "api",
      botId: "chatwoot",
      eventId: "message_created:123",
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
