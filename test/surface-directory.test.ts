import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSurfacePromptContextWithDirectory,
  recordSurfaceDirectoryIdentity,
} from "../src/channels/surface/surface-directory.ts";

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
      surfaces: Record<string, {
        displayName?: string;
        parentSurfaceId?: string;
        platform?: string;
      }>;
    };

    expect(payload.senders["telegram:1276408333"]?.displayName).toBe("The Longbkit");
    expect(payload.senders["telegram:1276408333"]?.handle).toBe("longbkit");
    expect(payload.surfaces["telegram:group:-1003455688247"]?.displayName).toBe(
      "workspace - clisbot",
    );
    expect(payload.surfaces["telegram:group:-1003455688247"]?.platform).toBe("telegram");
    expect(payload.surfaces["telegram:topic:-1003455688247:4335"]?.displayName).toBe(
      "clisbot-streaming",
    );
    expect(payload.surfaces["telegram:topic:-1003455688247:4335"]?.parentSurfaceId).toBe(
      "telegram:group:-1003455688247",
    );
    expect(payload.surfaces["telegram:topic:-1003455688247:4335"]?.platform).toBe("telegram");
  });

  test("stores Slack thread surfaces under the Slack platform", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-surface-directory-"));

    await recordSurfaceDirectoryIdentity({
      stateDir: tempDir,
      identity: {
        platform: "slack",
        conversationKind: "channel",
        senderId: "U123",
        senderName: "Alice",
        channelId: "C123",
        channelName: "eng",
        threadTs: "171234.567",
      },
    });

    const payload = JSON.parse(
      readFileSync(join(tempDir, "surface-directory.json"), "utf8"),
    ) as {
      surfaces: Record<string, { platform?: string; parentSurfaceId?: string }>;
    };

    expect(payload.surfaces["slack:channel:C123"]?.platform).toBe("slack");
    expect(payload.surfaces["slack:channel:C123:thread:171234.567"]?.platform).toBe("slack");
    expect(payload.surfaces["slack:channel:C123:thread:171234.567"]?.parentSurfaceId).toBe(
      "slack:channel:C123",
    );
  });

  test("enriches missing prompt display names from stored directory records", async () => {
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

    const context = await buildSurfacePromptContextWithDirectory({
      stateDir: tempDir,
      identity: {
        platform: "telegram",
        conversationKind: "topic",
        senderId: "1276408333",
        chatId: "-1003455688247",
        topicId: "4335",
      },
    });

    expect(context.sender?.displayName).toBe("The Longbkit");
    expect(context.sender?.handle).toBe("longbkit");
    expect(context.surface.displayName).toBe("clisbot-streaming");
    expect(context.surface.parent?.displayName).toBe("workspace - clisbot");
  });

  test("does not erase stored display metadata when a later event lacks names", async () => {
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

    await recordSurfaceDirectoryIdentity({
      stateDir: tempDir,
      identity: {
        platform: "telegram",
        conversationKind: "topic",
        senderId: "1276408333",
        chatId: "-1003455688247",
        topicId: "4335",
      },
    });

    const context = await buildSurfacePromptContextWithDirectory({
      stateDir: tempDir,
      identity: {
        platform: "telegram",
        conversationKind: "topic",
        senderId: "1276408333",
        chatId: "-1003455688247",
        topicId: "4335",
      },
    });

    expect(context.sender?.displayName).toBe("The Longbkit");
    expect(context.sender?.handle).toBe("longbkit");
    expect(context.surface.displayName).toBe("clisbot-streaming");
    expect(context.surface.parent?.displayName).toBe("workspace - clisbot");
  });

  test("enriches from legacy surface-directory records that predate explicit platform and thread kind metadata", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-surface-directory-"));
    writeFileSync(
      join(tempDir, "surface-directory.json"),
      `${JSON.stringify({
        version: 1,
        senders: {
          "slack:U123": {
            senderId: "slack:U123",
            platform: "slack",
            providerId: "U123",
            displayName: "Alice Smith",
            handle: "alice",
            updatedAt: Date.now(),
          },
        },
        surfaces: {
          "slack:channel:C123": {
            surfaceId: "slack:channel:C123",
            providerId: "C123",
            displayName: "release-ops",
            updatedAt: Date.now(),
          },
          "slack:channel:C123:thread:171234.5678": {
            surfaceId: "slack:channel:C123:thread:171234.5678",
            providerId: "171234.5678",
            parentSurfaceId: "slack:channel:C123",
            updatedAt: Date.now(),
          },
        },
      }, null, 2)}\n`,
    );

    const context = await buildSurfacePromptContextWithDirectory({
      stateDir: tempDir,
      identity: {
        platform: "slack",
        conversationKind: "channel",
        senderId: "U123",
        channelId: "C123",
        threadTs: "171234.5678",
      },
    });

    expect(context.sender?.displayName).toBe("Alice Smith");
    expect(context.sender?.handle).toBe("alice");
    expect(context.surface.displayName).toBeUndefined();
    expect(context.surface.parent?.displayName).toBe("release-ops");
    expect(context.surface.parent?.platform).toBe("slack");
  });
});
