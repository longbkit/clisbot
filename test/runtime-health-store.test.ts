import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeHealthStore } from "../src/control/runtime/runtime-health-store.ts";

describe("runtime health store", () => {
  test("normalizes legacy health instances that still store accountId", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-health-"));
    try {
      const healthPath = join(tempDir, "runtime-health.json");
      writeFileSync(
        healthPath,
        JSON.stringify(
          {
            channels: {
              slack: {
                channel: "slack",
                connection: "active",
                summary: "Slack Socket Mode connected for 1 bot(s).",
                actions: [],
                instances: [
                  {
                    accountId: "default",
                    label: "bot=@longluong2bot",
                  },
                ],
                updatedAt: "2026-04-18T16:00:00.000Z",
              },
            },
          },
          null,
          2,
        ),
      );

      const store = new RuntimeHealthStore(healthPath);
      const document = await store.read();

      expect(document.channels.slack?.instances).toEqual([
        {
          botId: "default",
          label: "bot=@longluong2bot",
        },
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
