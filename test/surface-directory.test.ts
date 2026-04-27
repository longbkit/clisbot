import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordSurfaceDirectoryIdentity } from "../src/channels/surface-directory.ts";

describe("surface directory", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("stores sender and surface display metadata without prompt formatting", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-surface-directory-"));

    await recordSurfaceDirectoryIdentity({
      stateDir: tempDir,
      identity: {
        platform: "telegram",
        conversationKind: "topic",
        senderId: "1276408333",
        senderName: "The Longbkit",
        senderHandle: "longbkit",
        chatId: "-1003455688247",
        chatName: "workspace - clisbot",
        topicId: "4335",
        topicName: "clisbot-streaming",
      },
    });

    const payload = JSON.parse(
      readFileSync(join(tempDir, "surface-directory.json"), "utf8"),
    ) as {
      senders: Record<string, { displayName?: string; handle?: string }>;
      surfaces: Record<string, { displayName?: string; parentSurfaceId?: string }>;
    };

    expect(payload.senders["telegram:1276408333"]?.displayName).toBe("The Longbkit");
    expect(payload.senders["telegram:1276408333"]?.handle).toBe("longbkit");
    expect(payload.surfaces["telegram:group:-1003455688247"]?.displayName).toBe(
      "workspace - clisbot",
    );
    expect(payload.surfaces["telegram:topic:-1003455688247:4335"]?.displayName).toBe(
      "clisbot-streaming",
    );
    expect(payload.surfaces["telegram:topic:-1003455688247:4335"]?.parentSurfaceId).toBe(
      "telegram:group:-1003455688247",
    );
  });
});
