import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clisbotConfigSchema } from "../../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../../src/config/core/template.ts";
import { renderLoopsHelp, runLoopsCli } from "../../src/control/commands/loops-cli.ts";
import { setRenderedCliName } from "../../src/control/commands/cli-name.ts";
import { buildConfig, enableSlackChannelRoute, enableSlackDirectMessages, enableTelegramTopicRoute, enableZaloBotDirectMessages } from "./loops-cli-support.ts";

describe("loops cli", () => {
  let tempDir = "";
  let previousConfigPath: string | undefined;
  let previousCliName: string | undefined;
  let previousFetch: typeof globalThis.fetch;
  let previousSlackAppToken: string | undefined;
  let previousSlackBotToken: string | undefined;
  const originalLog = console.log;

  beforeEach(() => {
    previousCliName = process.env.CLISBOT_CLI_NAME;
    delete process.env.CLISBOT_CLI_NAME;
    setRenderedCliName();
    previousFetch = globalThis.fetch;
    previousSlackAppToken = process.env.SLACK_APP_TOKEN;
    previousSlackBotToken = process.env.SLACK_BOT_TOKEN;
  });

  afterEach(() => {
    process.env.CLISBOT_CONFIG_PATH = previousConfigPath;
    process.env.CLISBOT_CLI_NAME = previousCliName;
    setRenderedCliName(previousCliName);
    process.env.SLACK_APP_TOKEN = previousSlackAppToken;
    process.env.SLACK_BOT_TOKEN = previousSlackBotToken;
    globalThis.fetch = previousFetch;
    console.log = originalLog;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("help covers routed create, cancel, and expression formats", () => {
    const help = renderLoopsHelp();

    expect(help).toContain("clisbot loops create --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --sender slack:U1234567890 every day at 07:00 check CI");
    expect(help).toContain("clisbot loops create --channel zalo-bot --target dm:user-123 --sender zalo-bot:user-123 5m check inbox");
    expect(help).toContain("clisbot loops create --help");
    expect(help).toContain("clisbot loops --channel telegram --target group:-1001234567890 --topic-id 42 --sender telegram:1276408333 5m");
    expect(help).toContain("clisbot loops cancel --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --all");
    expect(help).toContain("use clisbot loops --help --channel <channel-name> or clisbot loops create --help --channel <channel-name> for channel-specific target syntax and loop extensions");
    expect(help).toContain("channel child-surface flags are owned by each channel plugin");
    expect(help).toContain("clisbot loops create --channel slack --target group:C1234567890 --new-thread --sender slack:U1234567890 every day at 07:00 check CI");
    expect(help).toContain("forced interval: `1m --force check CI` or `check CI every 1m --force`");
    expect(help).toContain("times: `3 check CI` or `check CI 3 times`");
    expect(help).toContain("omit the prompt to load `LOOP.md` from the target workspace");
    expect(help).toContain("`--sender <principal>` is required when creating loops");
    expect(help).toContain("`--progress <count>` overrides loop progress-message injection");
    expect(help).toContain("first wall-clock loop returns `confirmation_required`");
  });

  test("slack-scoped overview help exposes the slack-only new-thread extension", async () => {
    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runLoopsCli(["--help", "--channel", "slack"]);

    const help = logs.join("\n");
    expect(help).toContain("Slack-specific extension:");
    expect(help).toContain("Slack `--target` accepts `group:<id>`, `dm:<user-or-channel-id>`, or raw `C...` / `G...` / `D...` ids");
    expect(help).toContain("`--new-thread` asks Slack to provision a fresh managed child thread before the loop is persisted");
    expect(help).toContain("clisbot loops create --channel slack --target group:C1234567890 --new-thread --sender slack:U1234567890 every day at 07:00 check CI");
    expect(help).not.toContain("--topic-id 42");
    expect(help).not.toContain("zalo-bot:user-123");
  });

  test("create help documents required creator metadata", async () => {
    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runLoopsCli(["create", "--help"]);

    const help = logs.join("\n");
    expect(help).toContain("clisbot loops create");
    expect(help).toContain("--sender <principal>");
    expect(help).toContain("--loop-start <none|brief|full>");
    expect(help).toContain("--progress <count>");
    expect(help).toContain("create without `--sender` fails by design");
  });

  test("slack-scoped create help exposes the slack-only new-thread extension", async () => {
    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runLoopsCli(["create", "--help", "--channel", "slack"]);

    const help = logs.join("\n");
    expect(help).toContain("Slack-specific extension:");
    expect(help).toContain("use `--thread-id` for an existing Slack thread ts");
    expect(help).toContain("clisbot loops create --channel slack --target dm:U1234567890 --new-thread --sender slack:U1234567890 every day at 09:00 check inbox");
    expect(help).not.toContain("--topic-id 42");
  });

  test("slack new-thread is rejected outside loop creation", async () => {
    await expect(
      runLoopsCli([
        "status",
        "--channel",
        "slack",
        "--target",
        "group:C1",
        "--new-thread",
      ]),
    ).rejects.toThrow("`--new-thread` only applies when creating a new child surface.");
  });

  test("slack new-thread requires slack channel and parent target", async () => {
    await expect(
      runLoopsCli([
        "create",
        "--new-thread",
        "--sender",
        "slack:U123",
        "5m",
        "check",
        "ci",
      ]),
    ).rejects.toThrow("`--new-thread` requires `--channel slack` and a parent `--target`.");
  });

  test("loop commands reject passing both --bot and --account aliases", async () => {
    await expect(
      runLoopsCli([
        "status",
        "--channel",
        "slack",
        "--target",
        "group:C1",
        "--bot",
        "work",
        "--account",
        "legacy",
      ]),
    ).rejects.toThrow("--bot and --account are aliases; use only one");
  });

  test("creates a zalo-bot DM loop with an explicit sender principal", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-loops-cli-zalo-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const storePath = join(tempDir, "sessions.json");
    writeFileSync(
      process.env.CLISBOT_CONFIG_PATH,
      JSON.stringify(
        enableZaloBotDirectMessages(
          buildConfig({
            socketPath: join(tempDir, "clisbot.sock"),
            storePath,
            workspaceTemplate: join(tempDir, "workspaces", "{agentId}"),
          }),
        ),
        null,
        2,
      ),
    );
    writeFileSync(storePath, JSON.stringify({}, null, 2));

    await runLoopsCli([
      "create",
      "--channel",
      "zalo-bot",
      "--target",
      "dm:user-123",
      "--sender",
      "zalo-bot:user-123",
      "5m",
      "check",
      "inbox",
    ]);

    const store = JSON.parse(readFileSync(storePath, "utf8")) as Record<string, any>;
    const session = Object.values(store).find(
      (entry: any) => entry?.sessionKey?.includes("zalo-bot:dm:user-123"),
    ) as any;
    expect(session?.sessionKey).toContain("zalo-bot:dm:user-123");
    expect(session.loops).toHaveLength(1);
    expect(session.loops[0].promptText).toBe("check inbox");
    expect(session.loops[0].sender.senderId).toBe("zalo-bot:user-123");
  });

  test("first wall-clock loop requires --confirm before persisting", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-loops-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const storePath = join(tempDir, "sessions.json");
    const config = enableSlackChannelRoute(
      buildConfig({
        socketPath: join(tempDir, "clisbot.sock"),
        storePath,
        workspaceTemplate: join(tempDir, "workspaces", "{agentId}"),
      }),
      "C1",
    );
    config.app.timezone = "Asia/Ho_Chi_Minh";
    writeFileSync(process.env.CLISBOT_CONFIG_PATH, JSON.stringify(config, null, 2));
    writeFileSync(storePath, JSON.stringify({}, null, 2));

    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runLoopsCli([
      "create",
      "--channel",
      "slack",
      "--target",
      "group:C1",
      "--sender",
      "slack:U123",
      "--sender-name",
      "The Longbkit",
      "--timezone",
      "America/Los_Angeles",
      "every",
      "day",
      "at",
      "07:00",
      "--loop-start",
      "none",
      "check",
      "CI",
    ]);

    expect(logs.join("\n")).toContain("confirmation_required: first wall-clock loop");
    expect(logs.join("\n")).toContain("timezone: America/Los_Angeles");
    expect(logs.join("\n")).toContain("--sender slack:U123");
    expect(logs.join("\n")).toContain("--sender-name 'The Longbkit'");
    expect(logs.join("\n")).toContain("--loop-start none");
    expect(logs.join("\n")).toContain("--confirm");
    const store = JSON.parse(readFileSync(storePath, "utf8")) as Record<string, unknown>;
    expect(Object.keys(store)).toHaveLength(0);
  });

  test("create without --sender fails before persisting", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-loops-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const storePath = join(tempDir, "sessions.json");
    writeFileSync(
      process.env.CLISBOT_CONFIG_PATH,
      JSON.stringify(
        enableSlackChannelRoute(
          buildConfig({
            socketPath: join(tempDir, "clisbot.sock"),
            storePath,
            workspaceTemplate: join(tempDir, "workspaces", "{agentId}"),
          }),
          "C1",
        ),
        null,
        2,
      ),
    );
    writeFileSync(storePath, JSON.stringify({}, null, 2));

    await expect(runLoopsCli([
      "create",
      "--channel",
      "slack",
      "--target",
      "group:C1",
      "5m",
      "check",
      "CI",
    ])).rejects.toThrow("Loop creation requires --sender <principal>");

    const store = JSON.parse(readFileSync(storePath, "utf8")) as Record<string, unknown>;
    expect(Object.keys(store)).toHaveLength(0);
  });

  test("list and status render the same active loop inventory", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-loops-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
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
      JSON.stringify(
        {
          "agent:default:slack:channel:c1:thread:100": {
            agentId: "default",
            sessionKey: "agent:default:slack:channel:c1:thread:100",
            workspacePath: join(tempDir, "workspaces", "default"),
            runnerCommand: "codex",
            intervalLoops: [
              {
                id: "loop123",
                intervalMs: 300_000,
                maxRuns: 20,
                attemptedRuns: 5,
                executedRuns: 4,
                skippedRuns: 1,
                createdAt: 1,
                updatedAt: 2,
                nextRunAt: 1_700_000_000_000,
                promptText: "check CI",
                promptSummary: "check CI",
                promptSource: "custom",
                force: false,
              },
            ],
            updatedAt: 2,
          },
        },
        null,
        2,
      ),
    );

    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runLoopsCli(["list"]);
    const listOutput = logs.join("\n");
    expect(listOutput).toContain("clisbot loops list");
    expect(listOutput).toContain("activeLoops.global: `1`");
    expect(listOutput).toContain("loop123");
    expect(listOutput).toContain("interval: `5m`");
    expect(listOutput).toContain("session: `agent:default:slack:channel:c1:thread:100`");

    logs.length = 0;
    await runLoopsCli(["status"]);
    const statusOutput = logs.join("\n");
    expect(statusOutput).toContain("clisbot loops status");
    expect(statusOutput).toContain("activeLoops.global: `1`");
    expect(statusOutput).toContain("loop123");
    expect(statusOutput).toContain("interval: `5m`");
  });

  test("create persists a loop progress override", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-loops-cli-progress-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const storePath = join(tempDir, "sessions.json");
    writeFileSync(
      process.env.CLISBOT_CONFIG_PATH,
      JSON.stringify(
        enableSlackChannelRoute(
          buildConfig({
            socketPath: join(tempDir, "clisbot.sock"),
            storePath,
            workspaceTemplate: join(tempDir, "workspaces", "{agentId}"),
          }),
          "C1",
        ),
        null,
        2,
      ),
    );
    writeFileSync(storePath, JSON.stringify({}, null, 2));

    await runLoopsCli([
      "create",
      "--channel",
      "slack",
      "--target",
      "group:C1",
      "--sender",
      "slack:U123",
      "--progress",
      "3",
      "5m",
      "check",
      "CI",
    ]);

    const store = JSON.parse(readFileSync(storePath, "utf8")) as Record<
      string,
      { loops?: Array<{ progressMessages?: number }> }
    >;
    expect(store["agent:default:slack:channel:c1"]?.loops?.[0]?.progressMessages).toBe(3);
  });

  test("cancel <id> removes a single persisted loop", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-loops-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
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
      JSON.stringify(
        {
          sessionA: {
            agentId: "default",
            sessionKey: "sessionA",
            workspacePath: join(tempDir, "workspaces", "default"),
            runnerCommand: "codex",
            intervalLoops: [
              {
                id: "loop123",
                intervalMs: 300_000,
                maxRuns: 20,
                attemptedRuns: 0,
                executedRuns: 0,
                skippedRuns: 0,
                createdAt: 1,
                updatedAt: 1,
                nextRunAt: 1_700_000_000_000,
                promptText: "check CI",
                promptSummary: "check CI",
                promptSource: "custom",
                force: false,
              },
              {
                id: "loop456",
                intervalMs: 600_000,
                maxRuns: 20,
                attemptedRuns: 0,
                executedRuns: 0,
                skippedRuns: 0,
                createdAt: 1,
                updatedAt: 1,
                nextRunAt: 1_700_000_100_000,
                promptText: "check deploy",
                promptSummary: "check deploy",
                promptSource: "custom",
                force: false,
              },
            ],
            updatedAt: 1,
          },
        },
        null,
        2,
      ),
    );

    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runLoopsCli(["cancel", "loop123"]);

    const output = logs.join("\n");
    expect(output).toContain("Cancelled loop `loop123`.");
    expect(output).toContain("activeLoops.global: `1`");

    const store = JSON.parse(readFileSync(storePath, "utf8")) as {
      sessionA: { loops: Array<{ id: string }>; intervalLoops?: Array<{ id: string }> };
    };
    expect(store.sessionA.loops.map((loop) => loop.id)).toEqual(["loop456"]);
    expect(store.sessionA.intervalLoops).toBeUndefined();
  });

  test("cancel --all removes every persisted loop across the app", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-loops-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
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
      JSON.stringify(
        {
          sessionA: {
            agentId: "default",
            sessionKey: "sessionA",
            workspacePath: join(tempDir, "workspaces", "default"),
            runnerCommand: "codex",
            intervalLoops: [
              {
                id: "loop123",
                intervalMs: 300_000,
                maxRuns: 20,
                attemptedRuns: 0,
                executedRuns: 0,
                skippedRuns: 0,
                createdAt: 1,
                updatedAt: 1,
                nextRunAt: 1_700_000_000_000,
                promptText: "check CI",
                promptSummary: "check CI",
                promptSource: "custom",
                force: false,
              },
            ],
            updatedAt: 1,
          },
          sessionB: {
            agentId: "default",
            sessionKey: "sessionB",
            workspacePath: join(tempDir, "workspaces", "default"),
            runnerCommand: "codex",
            intervalLoops: [
              {
                id: "loop456",
                kind: "calendar",
                cadence: "daily",
                localTime: "07:00",
                hour: 7,
                minute: 0,
                timezone: "Asia/Ho_Chi_Minh",
                maxRuns: 20,
                attemptedRuns: 3,
                executedRuns: 3,
                skippedRuns: 0,
                createdAt: 1,
                updatedAt: 1,
                nextRunAt: 1_700_000_100_000,
                promptText: "daily summary",
                promptSummary: "daily summary",
                promptSource: "custom",
                force: false,
              },
            ],
            updatedAt: 1,
          },
        },
        null,
        2,
      ),
    );

    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runLoopsCli(["cancel", "--all"]);

    const output = logs.join("\n");
    expect(output).toContain("Cancelled 2 active loops across the whole app.");
    expect(output).toContain("activeLoops.global: `0`");

    const store = JSON.parse(readFileSync(storePath, "utf8")) as Record<
      string,
      { loops?: unknown[]; intervalLoops?: unknown[] }
    >;
    expect(store.sessionA?.loops ?? []).toEqual([]);
    expect(store.sessionB?.loops ?? []).toEqual([]);
    expect(store.sessionA?.intervalLoops).toBeUndefined();
    expect(store.sessionB?.intervalLoops).toBeUndefined();
  });

});
