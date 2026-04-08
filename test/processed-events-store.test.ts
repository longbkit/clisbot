import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessedEventsStore } from "../src/channels/processed-events-store.ts";

describe("ProcessedEventsStore", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("persists processing and completed statuses", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "muxbot-events-"));
    const filePath = join(tempDir, "processed-events.json");
    const store = new ProcessedEventsStore(filePath);

    expect(await store.getStatus("event-1")).toBeUndefined();

    await store.markProcessing("event-1");
    expect(await store.getStatus("event-1")).toBe("processing");

    const reloaded = new ProcessedEventsStore(filePath);
    expect(await reloaded.getStatus("event-1")).toBe("processing");

    await reloaded.markCompleted("event-1");
    expect(await reloaded.getStatus("event-1")).toBe("completed");
  });
});
