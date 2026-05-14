import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clisbotConfigSchema } from "../../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../../src/config/core/template.ts";
import { renderLoopsHelp, runLoopsCli } from "../../src/control/commands/loops-cli.ts";
import { setRenderedCliName } from "../../src/control/commands/cli-name.ts";
import { buildConfig, enableSlackChannelRoute, enableSlackDirectMessages, enableTelegramTopicRoute } from "./loops-cli-support.ts";

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
  test("scoped list and status render only loops for the targeted session", async () => {
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
                attemptedRuns: 1,
                executedRuns: 1,
                skippedRuns: 0,
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
          "agent:default:slack:channel:c1:thread:200": {
            agentId: "default",
            sessionKey: "agent:default:slack:channel:c1:thread:200",
            workspacePath: join(tempDir, "workspaces", "default"),
            runnerCommand: "codex",
            intervalLoops: [
              {
                id: "loop456",
                intervalMs: 600_000,
                maxRuns: 20,
                attemptedRuns: 1,
                executedRuns: 1,
                skippedRuns: 0,
                createdAt: 1,
                updatedAt: 2,
                nextRunAt: 1_700_000_100_000,
                promptText: "check deploy",
                promptSummary: "check deploy",
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

    for (const command of ["list", "status"]) {
      logs.length = 0;
      await runLoopsCli([
        command,
        "--channel",
        "slack",
        "--target",
        "group:C1",
        "--thread-id",
        "100",
      ]);

      const output = logs.join("\n");
      expect(output).toContain(`clisbot loops ${command} --channel slack --target group:C1 --thread-id 100`);
      expect(output).toContain("sessionKey: `agent:default:slack:channel:c1:thread:100`");
      expect(output).toContain("activeLoops.session: `1`");
      expect(output).toContain("activeLoops.global: `2`");
      expect(output).toContain("loop123");
      expect(output).not.toContain("loop456");
    }

    await expect(runLoopsCli(["list", "--surface", "slack:channel:C1:thread:100"]))
      .rejects.toThrow("Loop commands use --channel/--target addressing");
    await expect(runLoopsCli([
      "status",
      "--session-key",
      "agent:default:slack:channel:c1:thread:100",
    ])).rejects.toThrow("Loop commands use --channel/--target addressing");
  });

  test("bare scoped create persists a calendar loop and scoped cancel removes it", async () => {
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

    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runLoopsCli([
      "--channel",
      "slack",
      "--target",
      "group:C1",
      "--thread-id",
      "100",
      "--sender",
      "slack:u123",
      "--sender-name",
      "The Longbkit",
      "--sender-handle",
      "longbkit",
      "--progress",
      "2",
      "every",
      "day",
      "at",
      "07:00",
      "--loop-start",
      "full",
      "check",
      "CI",
      "--confirm",
    ]);

    const createdOutput = logs.join("\n");
    expect(createdOutput).toContain("Started loop `");
    expect(createdOutput).toContain("every day at 07:00");
    expect(createdOutput).toContain("cancel: `clisbot loops cancel --channel slack --target group:C1 --thread-id 100 ");

    const createdStore = JSON.parse(readFileSync(storePath, "utf8")) as Record<
      string,
      {
        loops?: Array<{
          id: string;
          kind?: string;
          loopStart?: string;
          progressMessages?: number;
          promptSummary?: string;
          createdBy?: string;
          sender?: { senderId?: string; providerId?: string; displayName?: string; handle?: string };
        }>;
      }
    >;
    const sessionEntry = createdStore["agent:default:slack:channel:c1:thread:100"];
    expect(sessionEntry?.loops).toHaveLength(1);
    expect(sessionEntry?.loops?.[0]?.kind).toBe("calendar");
    expect(sessionEntry?.loops?.[0]?.loopStart).toBe("full");
    expect(sessionEntry?.loops?.[0]?.progressMessages).toBe(2);
    expect(sessionEntry?.loops?.[0]?.promptSummary).toBe("check CI");
    expect(sessionEntry?.loops?.[0]?.createdBy).toBe("U123");
    expect(sessionEntry?.loops?.[0]?.sender).toEqual({
      senderId: "slack:U123",
      providerId: "U123",
      displayName: "The Longbkit",
      handle: "longbkit",
    });

    const loopId = sessionEntry?.loops?.[0]?.id;
    expect(loopId).toBeTruthy();

    logs.length = 0;
    await runLoopsCli([
      "cancel",
      "--channel",
      "slack",
      "--target",
      "group:C1",
      "--thread-id",
      "100",
    ]);

    const cancelOutput = logs.join("\n");
    expect(cancelOutput).toContain(`Cancelled loop \`${loopId}\`.`);

    const cancelledStore = JSON.parse(readFileSync(storePath, "utf8")) as Record<
      string,
      { loops?: Array<{ id: string }> }
    >;
    expect(cancelledStore["agent:default:slack:channel:c1:thread:100"]?.loops ?? []).toHaveLength(0);
  }, { timeout: 15_000 });

  test("telegram scoped create uses --topic-id and persists into the topic session", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-loops-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const storePath = join(tempDir, "sessions.json");
    writeFileSync(
      process.env.CLISBOT_CONFIG_PATH,
      JSON.stringify(
        enableTelegramTopicRoute(
          buildConfig({
            socketPath: join(tempDir, "clisbot.sock"),
            storePath,
            workspaceTemplate: join(tempDir, "workspaces", "{agentId}"),
          }),
          "-1001",
          "42",
        ),
        null,
        2,
      ),
    );
    writeFileSync(storePath, JSON.stringify({}, null, 2));

    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runLoopsCli([
      "--channel",
      "telegram",
      "--target",
      "group:-1001",
      "--topic-id",
      "42",
      "--sender",
      "telegram:1276408333",
      "every",
      "weekday",
      "at",
      "07:00",
      "standup",
      "--confirm",
    ]);

    const output = logs.join("\n");
    expect(output).toContain("Started loop `");
    expect(output).toContain("cancel: `clisbot loops cancel --channel telegram --target group:-1001 --topic-id 42 ");

    const createdStore = JSON.parse(readFileSync(storePath, "utf8")) as Record<
      string,
      { loops?: Array<{ kind?: string; promptSummary?: string }> }
    >;
    expect(createdStore["agent:default:telegram:group:-1001:topic:42"]?.loops).toHaveLength(1);
    expect(createdStore["agent:default:telegram:group:-1001:topic:42"]?.loops?.[0]?.kind).toBe("calendar");
    expect(createdStore["agent:default:telegram:group:-1001:topic:42"]?.loops?.[0]?.promptSummary).toBe("standup");
  });

  test("telegram scoped create accepts the legacy --thread-id alias and still persists into the topic session", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-loops-cli-thread-alias-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const storePath = join(tempDir, "sessions.json");
    writeFileSync(
      process.env.CLISBOT_CONFIG_PATH,
      JSON.stringify(
        enableTelegramTopicRoute(
          buildConfig({
            socketPath: join(tempDir, "clisbot.sock"),
            storePath,
            workspaceTemplate: join(tempDir, "workspaces", "{agentId}"),
          }),
          "-1001",
          "42",
        ),
        null,
        2,
      ),
    );
    writeFileSync(storePath, JSON.stringify({}, null, 2));
    console.log = (() => undefined) as typeof console.log;

    await runLoopsCli([
      "--channel",
      "telegram",
      "--target",
      "group:-1001",
      "--thread-id",
      "42",
      "--sender",
      "telegram:1276408333",
      "5m",
      "standup",
    ]);

    const createdStore = JSON.parse(readFileSync(storePath, "utf8")) as Record<
      string,
      { loops?: Array<{ promptSummary?: string }> }
    >;
    expect(createdStore["agent:default:telegram:group:-1001:topic:42"]?.loops).toHaveLength(1);
    expect(createdStore["agent:default:telegram:group:-1001:topic:42"]?.loops?.[0]?.promptSummary).toBe("standup");
  });

  test("slack new-thread create provisions a fresh thread before persisting the loop", async () => {
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
    config.bots.slack.default.appToken = "${SLACK_APP_TOKEN}";
    config.bots.slack.default.botToken = "${SLACK_BOT_TOKEN}";
    writeFileSync(process.env.CLISBOT_CONFIG_PATH, JSON.stringify(config, null, 2));
    writeFileSync(storePath, JSON.stringify({}, null, 2));
    process.env.SLACK_APP_TOKEN = "xapp-test";
    process.env.SLACK_BOT_TOKEN = "xoxb-test";

    const slackCalls: Array<{ url: string; payload: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      slackCalls.push({ url, payload });
      if (url.endsWith("/chat.postMessage")) {
        return new Response(JSON.stringify({ ok: true, ts: "171234.999" }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof globalThis.fetch;

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
      "--new-thread",
      "--sender",
      "slack:U123",
      "every",
      "day",
      "at",
      "07:00",
      "check",
      "CI",
      "--confirm",
    ]);

    expect(slackCalls).toHaveLength(1);
    expect(slackCalls[0]?.url).toContain("/chat.postMessage");
    expect(slackCalls[0]?.payload.channel).toBe("C1");
    expect(String(slackCalls[0]?.payload.text ?? "")).toContain("Managed loop child surface created.");

    const output = logs.join("\n");
    expect(output).toContain("cancel: `clisbot loops cancel --channel slack --target group:C1 --thread-id 171234.999 ");

    const createdStore = JSON.parse(readFileSync(storePath, "utf8")) as Record<
      string,
      { loops?: Array<{ kind?: string }> }
    >;
    expect(createdStore["agent:default:slack:channel:c1:thread:171234.999"]?.loops).toHaveLength(1);
  });

  test("slack DM new-thread create opens the DM, stores the user session, and binds delivery to the DM channel thread", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-loops-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const storePath = join(tempDir, "sessions.json");
    const config = enableSlackDirectMessages(
      buildConfig({
        socketPath: join(tempDir, "clisbot.sock"),
        storePath,
        workspaceTemplate: join(tempDir, "workspaces", "{agentId}"),
      }),
    );
    config.bots.slack.default.appToken = "${SLACK_APP_TOKEN}";
    config.bots.slack.default.botToken = "${SLACK_BOT_TOKEN}";
    writeFileSync(process.env.CLISBOT_CONFIG_PATH, JSON.stringify(config, null, 2));
    writeFileSync(storePath, JSON.stringify({}, null, 2));
    process.env.SLACK_APP_TOKEN = "xapp-test";
    process.env.SLACK_BOT_TOKEN = "xoxb-test";

    const slackCalls: Array<{ url: string; payload: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      slackCalls.push({ url, payload });
      if (url.endsWith("/conversations.open")) {
        return new Response(JSON.stringify({ ok: true, channel: { id: "D777" } }), { status: 200 });
      }
      if (url.endsWith("/chat.postMessage")) {
        return new Response(JSON.stringify({ ok: true, ts: "171234.100" }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof globalThis.fetch;

    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runLoopsCli([
      "create",
      "--channel",
      "slack",
      "--target",
      "dm:U123",
      "--new-thread",
      "--sender",
      "slack:U123",
      "every",
      "day",
      "at",
      "09:00",
      "check",
      "inbox",
      "--confirm",
    ]);

    expect(slackCalls.some((call) => call.url.endsWith("/conversations.open"))).toBe(true);
    expect(slackCalls.some((call) => call.url.endsWith("/chat.postMessage"))).toBe(true);

    const output = logs.join("\n");
    expect(output).toContain("cancel: `clisbot loops cancel --channel slack --target dm:U123 --thread-id 171234.100 ");

    const createdStore = JSON.parse(readFileSync(storePath, "utf8")) as Record<
      string,
      { loops?: Array<{ surfaceBinding?: { channelId?: string; threadTs?: string } }> }
    >;
    const sessionEntry = createdStore["agent:default:slack:dm:u123"];
    expect(sessionEntry?.loops).toHaveLength(1);
    expect(sessionEntry?.loops?.[0]?.surfaceBinding?.channelId).toBe("D777");
    expect(sessionEntry?.loops?.[0]?.surfaceBinding?.threadTs).toBe("171234.100");
  });
});
