import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SurfaceNotificationRequest } from "../src/agents/runtime/surface-runtime.ts";
import { SurfaceRuntime } from "../src/agents/runtime/surface-runtime.ts";
import { createStoredQueueItem } from "../src/agents/queue/queue-state.ts";
import type { LoadedConfig } from "../src/config/core/load-config.ts";
import { clisbotConfigSchema } from "../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/core/template.ts";

function createLoadedConfig(tempDir: string): LoadedConfig {
  const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
  config.agents.list = [{ id: "default" }];
  config.bots.telegram.defaults.enabled = true;
  config.bots.telegram.default.enabled = true;
  config.bots.telegram.default.responseMode = "message-tool";
  config.bots.zaloBot.defaults.enabled = true;
  config.bots.zaloBot.default.enabled = true;
  config.bots.zaloBot.default.responseMode = "capture-pane";

  return {
    configPath: join(tempDir, "clisbot.json"),
    processedEventsPath: join(tempDir, "processed-events.json"),
    stateDir: tempDir,
    raw: {
      ...config,
      session: {
        ...config.app.session,
        dmScope: config.bots.defaults.dmScope,
      },
      control: config.app.control,
      tmux: config.agents.defaults.runner.defaults.tmux,
    },
  };
}

describe("surface runtime", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("buildManagedQueuePrompt uses zalo-bot surface modes instead of falling back to telegram", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-surface-runtime-"));
    const runtime = new SurfaceRuntime(createLoadedConfig(tempDir));

    const prompt = await runtime.buildManagedQueuePrompt(
      "default",
      createStoredQueueItem({
        promptText: "ping",
        createdBy: "user-123",
        sender: {
          providerId: "user-123",
          displayName: "Alice Smith",
        },
        surfaceBinding: {
          platform: "zalo-bot",
          botId: "default",
          conversationKind: "dm",
          chatId: "user-123",
        },
      }),
    );

    expect(prompt).toContain("channel auto-delivery remains enabled");
    expect(prompt).not.toContain("To send a user-visible progress update or final reply");
  });

  test("notifyManagedQueueStart honors exact Slack route notification overrides through the plugin seam", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-surface-runtime-"));
    const loaded = createLoadedConfig(tempDir);
    loaded.raw.bots.slack.defaults.enabled = true;
    loaded.raw.bots.slack.default.enabled = true;
    loaded.raw.bots.slack.default.surfaceNotifications = {
      queueStart: "brief",
      loopStart: "brief",
    };
    loaded.raw.bots.slack.default.groups = {
      C1: {
        enabled: true,
        policy: "open",
        allowUsers: [],
        blockUsers: [],
        surfaceNotifications: {
          queueStart: "none",
          loopStart: "brief",
        },
      },
    };

    const runtime = new SurfaceRuntime(loaded);
    const notifications: SurfaceNotificationRequest[] = [];
    runtime.registerSurfaceNotificationHandler({
      platform: "slack",
      botId: "default",
      handler: async (request) => {
        notifications.push(request);
      },
    });

    await runtime.notifyManagedQueueStart(
      { agentId: "default", sessionKey: "agent:default:slack:channel:c1" },
      createStoredQueueItem({
        promptText: "ping",
        createdBy: "U123",
        sender: {
          providerId: "U123",
          displayName: "Alice Smith",
        },
        surfaceBinding: {
          platform: "slack",
          botId: "default",
          conversationKind: "channel",
          channelId: "C1",
        },
      }),
    );

    expect(notifications).toHaveLength(0);
  });
});
