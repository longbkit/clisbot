import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PROTECTED_CONTROL_RULE } from "../src/auth/defaults.ts";
import { clisbotConfigSchema } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";
import {
  renderQueueCreatedNotification,
  renderQueuesHelp,
  runQueuesCli,
} from "../src/control/queues-cli.ts";

function buildConfig(params: {
  socketPath: string;
  storePath: string;
  workspaceTemplate: string;
}) {
  const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
  config.app.session.storePath = params.storePath;
  config.agents.defaults.workspace = params.workspaceTemplate;
  config.agents.defaults.runner.defaults.tmux.socketPath = params.socketPath;
  config.agents.defaults.runner.defaults.trustWorkspace = false;
  config.agents.list = [{ id: "default" }];
  config.app.control.configReload.watch = false;
  config.app.control.sessionCleanup.enabled = false;
  config.bots.slack.defaults.enabled = false;
  config.bots.telegram.defaults.enabled = true;
  config.bots.telegram.default.groups["-1001"] = {
    enabled: true,
    policy: "open",
    requireMention: true,
    allowBots: false,
    allowUsers: [],
    blockUsers: [],
    topics: {
      "4335": {
        enabled: true,
        policy: "open",
        requireMention: true,
        allowBots: false,
        allowUsers: [],
        blockUsers: [],
      },
    },
  };
  return config;
}

describe("queues cli", () => {
  let tempDir = "";
  let previousConfigPath: string | undefined;
  const originalLog = console.log;
  const noQueueNotification = {
    sendQueueCreatedNotification: async () => undefined,
  };

  beforeEach(() => {
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
  });

  afterEach(() => {
    process.env.CLISBOT_CONFIG_PATH = previousConfigPath;
    console.log = originalLog;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("help documents explicit addressing and no current queue", () => {
    const help = renderQueuesHelp();

    expect(help).toContain("queues create --channel telegram --target group:-1001234567890 --topic-id 4335 --sender telegram:1276408333");
    expect(help).toContain("queues create --channel zalo-bot --target dm:user-123 --sender zalo-bot:user-123 review inbox");
    expect(help).toContain("control.queue.maxPendingItemsPerSession");
    expect(help).toContain("create requires explicit --channel/--target addressing plus --sender");
    expect(help).not.toContain("--session-key");
    expect(help).not.toContain("--surface");
    expect(help).toContain("--current is not supported");
  });

  test("creates, lists, and clears a scoped telegram queue item", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-queues-cli-"));
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const storePath = join(tempDir, "sessions.json");
    writeFileSync(
      process.env.CLISBOT_CONFIG_PATH,
      JSON.stringify(
        buildConfig({
          socketPath: join(tempDir, "clisbot.sock"),
          storePath,
          workspaceTemplate: join(tempDir, "workspaces", "{agentId}"),
        }),
        null,
        2,
      ),
    );
    writeFileSync(storePath, JSON.stringify({}, null, 2));
    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runQueuesCli([
      "create",
      "--channel",
      "telegram",
      "--target",
      "group:-1001",
      "--topic-id",
      "4335",
      "--sender",
      "telegram:1276408333",
      "review",
      "queue",
      "state",
    ], noQueueNotification);
    const storeDuring = JSON.parse(readFileSync(storePath, "utf8")) as Record<string, any>;
    const item = storeDuring["agent:default:telegram:group:-1001:topic:4335"].queues[0];
    expect(item.promptText).toBe("review queue state");
    expect(item.surfaceBinding).toMatchObject({
      platform: "telegram",
      conversationKind: "topic",
      chatId: "-1001",
      topicId: "4335",
    });
    expect(item.protectedControlMutationRule).toBe(DEFAULT_PROTECTED_CONTROL_RULE);
    await runQueuesCli(["list", "--channel", "telegram", "--target", "group:-1001", "--topic-id", "4335"]);
    await runQueuesCli(["clear", "--channel", "telegram", "--target", "group:-1001", "--topic-id", "4335"]);

    const output = logs.join("\n");
    expect(output).toContain("Queued prompt");
    expect(output).toContain("review queue state");
    expect(output).toContain("Cleared 1 pending queued prompt");
    const store = JSON.parse(readFileSync(storePath, "utf8")) as Record<string, any>;
    expect(store["agent:default:telegram:group:-1001:topic:4335"].queues).toEqual([]);
  });

  test("create posts a surface acknowledgement with position and full prompt", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-queues-cli-notify-"));
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const storePath = join(tempDir, "sessions.json");
    writeFileSync(
      process.env.CLISBOT_CONFIG_PATH,
      JSON.stringify(
        buildConfig({
          socketPath: join(tempDir, "clisbot.sock"),
          storePath,
          workspaceTemplate: join(tempDir, "workspaces", "{agentId}"),
        }),
        null,
        2,
      ),
    );
    const older = {
      id: "older",
      status: "pending",
      createdAt: Date.now() - 1_000,
      updatedAt: Date.now() - 1_000,
      promptText: "older prompt",
      promptSummary: "older prompt",
      promptSource: "custom",
    };
    writeFileSync(
      storePath,
      JSON.stringify({
        "agent:default:telegram:group:-1001:topic:4335": {
          agentId: "default",
          sessionKey: "agent:default:telegram:group:-1001:topic:4335",
          workspacePath: join(tempDir, "workspaces", "default"),
          runnerCommand: "codex",
          queues: [older],
          updatedAt: Date.now(),
        },
      }, null, 2),
    );

    const notifications: Array<{ positionAhead: number; text: string }> = [];
    await runQueuesCli([
      "create",
      "--channel",
      "telegram",
      "--target",
      "group:-1001",
      "--topic-id",
      "4335",
      "--sender",
      "telegram:1276408333",
      "review",
      "queue",
      "state",
    ], {
      print: () => undefined,
      sendQueueCreatedNotification: async ({ positionAhead, text }) => {
        notifications.push({ positionAhead, text });
      },
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.positionAhead).toBe(1);
    expect(notifications[0]?.text).toMatch(/^Queued `[^`]+`: 1 ahead\.\n\nreview queue state$/);
    expect(notifications[0]?.text).not.toContain("Prompt:");
  });

  test("renders queue created notifications without truncating the prompt", () => {
    const prompt = "line one\nline two with `code` and enough detail";

    expect(renderQueueCreatedNotification({ queueId: "queue-1", positionAhead: 0, promptText: prompt }))
      .toBe("Queued `queue-1`.\n\nline one\nline two with `code` and enough detail");
    expect(renderQueueCreatedNotification({ queueId: "queue-2", positionAhead: 2, promptText: prompt }))
      .toBe("Queued `queue-2`: 2 ahead.\n\nline one\nline two with `code` and enough detail");
  });

  test("create without --sender fails before persisting", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-queues-cli-no-sender-"));
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const storePath = join(tempDir, "sessions.json");
    writeFileSync(
      process.env.CLISBOT_CONFIG_PATH,
      JSON.stringify(
        buildConfig({
          socketPath: join(tempDir, "clisbot.sock"),
          storePath,
          workspaceTemplate: join(tempDir, "workspaces", "{agentId}"),
        }),
        null,
        2,
      ),
    );
    writeFileSync(storePath, JSON.stringify({}, null, 2));

    await expect(runQueuesCli([
      "create",
      "--channel",
      "telegram",
      "--target",
      "group:-1001",
      "--topic-id",
      "4335",
      "review",
      "queue",
    ])).rejects.toThrow(
      "Queue creation requires --sender <principal>, for example --sender telegram:1276408333, --sender slack:U1234567890, or --sender zalo-bot:user-123.",
    );

    const store = JSON.parse(readFileSync(storePath, "utf8")) as Record<string, unknown>;
    expect(Object.keys(store)).toHaveLength(0);
  });

  test("create rejects --session-key before persisting", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-queues-cli-session-key-"));
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const storePath = join(tempDir, "sessions.json");
    writeFileSync(
      process.env.CLISBOT_CONFIG_PATH,
      JSON.stringify(
        buildConfig({
          socketPath: join(tempDir, "clisbot.sock"),
          storePath,
          workspaceTemplate: join(tempDir, "workspaces", "{agentId}"),
        }),
        null,
        2,
      ),
    );
    writeFileSync(
      storePath,
      JSON.stringify({
        "agent:default:telegram:group:-1001:topic:4335": {
          agentId: "default",
          sessionKey: "agent:default:telegram:group:-1001:topic:4335",
          workspacePath: join(tempDir, "workspaces", "default"),
          runnerCommand: "codex",
          updatedAt: Date.now(),
        },
        "agent:default:main": {
          agentId: "default",
          sessionKey: "agent:default:main",
          workspacePath: join(tempDir, "workspaces", "default"),
          runnerCommand: "codex",
          updatedAt: Date.now(),
        },
      }, null, 2),
    );
    console.log = (() => undefined) as typeof console.log;

    await expect(runQueuesCli([
      "create",
      "--session-key",
      "agent:default:telegram:group:-1001:topic:4335",
      "--sender",
      "telegram:1276408333",
      "review",
      "session",
      "queue",
    ])).rejects.toThrow(
      "Queue commands use --channel/--target addressing; --surface and --session-key are not supported.",
    );
    await expect(runQueuesCli([
      "create",
      "--channel",
      "telegram",
      "--target",
      "group:-1001",
      "--topic-id",
      "4335",
      "--sender",
      "slack:U123",
      "wrong",
      "sender",
    ])).rejects.toThrow("sender platform must match --channel telegram");

    const store = JSON.parse(readFileSync(storePath, "utf8")) as Record<string, any>;
    expect(store["agent:default:telegram:group:-1001:topic:4335"].queues).toBeUndefined();
    expect(store["agent:default:main"].queues).toBeUndefined();
  });

  test("creates a scoped zalo-bot DM queue item", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-queues-cli-zalo-"));
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const storePath = join(tempDir, "sessions.json");
    const config = buildConfig({
      socketPath: join(tempDir, "clisbot.sock"),
      storePath,
      workspaceTemplate: join(tempDir, "workspaces", "{agentId}"),
    });
    config.bots.telegram.defaults.enabled = false;
    config.bots.zaloBot.defaults.enabled = true;
    config.bots.zaloBot.default.directMessages["*"] = {
      enabled: true,
      policy: "open",
      allowUsers: [],
      blockUsers: [],
      requireMention: false,
      allowBots: false,
      agentId: "default",
    };
    writeFileSync(process.env.CLISBOT_CONFIG_PATH, JSON.stringify(config, null, 2));
    writeFileSync(storePath, JSON.stringify({}, null, 2));

    await runQueuesCli([
      "create",
      "--channel",
      "zalo-bot",
      "--target",
      "dm:user-123",
      "--sender",
      "zalo-bot:user-123",
      "review",
      "zalo",
      "queue",
    ], noQueueNotification);

    const store = JSON.parse(readFileSync(storePath, "utf8")) as Record<string, any>;
    const item = store["agent:default:zalo-bot:dm:user-123"].queues[0];
    expect(item.promptText).toBe("review zalo queue");
    expect(item.surfaceBinding).toMatchObject({
      platform: "zalo-bot",
      conversationKind: "dm",
      chatId: "user-123",
    });
    expect(item.sender.senderId).toBe("zalo-bot:user-123");
  });

  test("create rejects --surface before persisting", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-queues-cli-surface-create-"));
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const storePath = join(tempDir, "sessions.json");
    writeFileSync(
      process.env.CLISBOT_CONFIG_PATH,
      JSON.stringify(
        buildConfig({
          socketPath: join(tempDir, "clisbot.sock"),
          storePath,
          workspaceTemplate: join(tempDir, "workspaces", "{agentId}"),
        }),
        null,
        2,
      ),
    );
    writeFileSync(storePath, JSON.stringify({}, null, 2));
    console.log = (() => undefined) as typeof console.log;

    await expect(runQueuesCli([
      "create",
      "--surface",
      "telegram:topic:-1001:4335",
      "--sender",
      "telegram:1276408333",
      "review",
      "queue",
    ])).rejects.toThrow(
      "Queue commands use --channel/--target addressing; --surface and --session-key are not supported.",
    );

    const store = JSON.parse(readFileSync(storePath, "utf8")) as Record<string, unknown>;
    expect(Object.keys(store)).toHaveLength(0);
  });

  test("create enforces the configured per-session pending queue limit", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-queues-cli-limit-"));
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const storePath = join(tempDir, "sessions.json");
    const config = buildConfig({
      socketPath: join(tempDir, "clisbot.sock"),
      storePath,
      workspaceTemplate: join(tempDir, "workspaces", "{agentId}"),
    });
    config.app.control.queue.maxPendingItemsPerSession = 2;
    writeFileSync(process.env.CLISBOT_CONFIG_PATH, JSON.stringify(config, null, 2));
    writeFileSync(storePath, JSON.stringify({}, null, 2));
    console.log = (() => undefined) as typeof console.log;

    const base = [
      "create",
      "--channel",
      "telegram",
      "--target",
      "group:-1001",
      "--topic-id",
      "4335",
      "--sender",
      "telegram:1276408333",
    ];
    await runQueuesCli([...base, "one"], noQueueNotification);
    await runQueuesCli([...base, "two"], noQueueNotification);
    await expect(runQueuesCli([...base, "three"])).rejects.toThrow(
      "configured max of `2`",
    );
  });
});
