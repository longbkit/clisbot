import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clisbotConfigSchema } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";
import { renderLoopsHelp, runLoopsCli } from "../src/control/loops-cli.ts";

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
  config.agents.defaults.runner.defaults.startupDelayMs = 1;
  config.agents.defaults.runner.defaults.promptSubmitDelayMs = 1;
  config.agents.defaults.runner.defaults.stream.captureLines = 80;
  config.agents.defaults.runner.defaults.stream.updateIntervalMs = 1000;
  config.agents.defaults.runner.defaults.stream.idleTimeoutMs = 60_000;
  config.agents.defaults.runner.defaults.stream.noOutputTimeoutMs = 60_000;
  config.agents.defaults.runner.defaults.stream.maxRuntimeSec = 900;
  config.agents.defaults.runner.defaults.stream.maxRuntimeMin = undefined;
  config.agents.defaults.runner.defaults.stream.maxMessageChars = 4000;
  config.agents.defaults.runner.codex.sessionId = {
    create: {
      mode: "runner",
      args: [],
    },
    capture: {
      mode: "status-command",
      statusCommand: "/status",
      pattern: "session id:\\s*(.+)",
      timeoutMs: 10,
      pollIntervalMs: 1,
    },
    resume: {
      mode: "command",
      args: ["resume", "{sessionId}"],
    },
  };
  config.agents.list = [{ id: "default" }];
  config.app.control.configReload.watch = false;
  config.app.control.sessionCleanup.enabled = false;
  config.bots.slack.defaults.enabled = false;
  config.bots.telegram.defaults.enabled = false;
  return config;
}

function enableSlackChannelRoute(
  config: ReturnType<typeof buildConfig>,
  channelId: string,
) {
  config.bots.slack.defaults.enabled = true;
  config.bots.slack.default.groups[channelId] = {
    enabled: true,
    policy: "open",
    requireMention: true,
    allowBots: false,
    allowUsers: [],
    blockUsers: [],
  };
  return config;
}

function enableSlackDirectMessages(config: ReturnType<typeof buildConfig>) {
  config.bots.slack.defaults.enabled = true;
  config.bots.slack.default.directMessages["dm:*"] = {
    enabled: true,
    policy: "open",
    requireMention: false,
    allowBots: false,
    allowUsers: [],
    blockUsers: [],
  };
  return config;
}

function enableTelegramTopicRoute(
  config: ReturnType<typeof buildConfig>,
  chatId: string,
  topicId: string,
) {
  config.bots.telegram.defaults.enabled = true;
  config.bots.telegram.default.groups[chatId] = {
    enabled: true,
    policy: "open",
    requireMention: true,
    allowBots: false,
    allowUsers: [],
    blockUsers: [],
    topics: {
      [topicId]: {
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
    previousFetch = globalThis.fetch;
    previousSlackAppToken = process.env.SLACK_APP_TOKEN;
    previousSlackBotToken = process.env.SLACK_BOT_TOKEN;
  });

  afterEach(() => {
    process.env.CLISBOT_CONFIG_PATH = previousConfigPath;
    process.env.CLISBOT_CLI_NAME = previousCliName;
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

    expect(help).toContain("clisbot loops create --channel slack --target group:C1234567890 --thread-id 1712345678.123456 every day at 07:00 check CI");
    expect(help).toContain("clisbot loops create --channel slack --target group:C1234567890 --new-thread every day at 07:00 check CI");
    expect(help).toContain("clisbot loops --channel slack --target group:C1234567890 --thread-id 1712345678.123456 3 review backlog");
    expect(help).toContain("clisbot loops cancel --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --all");
    expect(help).toContain("Slack `--target` accepts `group:<id>`, `dm:<user-or-channel-id>`, or raw `C...` / `G...` / `D...` ids");
    expect(help).toContain("use `--thread-id` for an existing Slack thread ts");
    expect(help).toContain("use `--topic-id` for a Telegram topic id");
    expect(help).toContain("`--new-thread` is Slack-only and creates a fresh thread anchor before the loop starts");
    expect(help).toContain("forced interval: `1m --force check CI` or `check CI every 1m --force`");
    expect(help).toContain("times: `3 check CI` or `check CI 3 times`");
    expect(help).toContain("omit the prompt to load `LOOP.md` from the target workspace");
    expect(help).toContain("first wall-clock loop returns `confirmation_required`");
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
      "--timezone",
      "America/Los_Angeles",
      "every",
      "day",
      "at",
      "07:00",
      "check",
      "CI",
    ]);

    expect(logs.join("\n")).toContain("confirmation_required: first wall-clock loop");
    expect(logs.join("\n")).toContain("timezone: America/Los_Angeles");
    expect(logs.join("\n")).toContain("--confirm");
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

  test("scoped status renders only loops for the targeted session", async () => {
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

    await runLoopsCli([
      "status",
      "--channel",
      "slack",
      "--target",
      "group:C1",
      "--thread-id",
      "100",
    ]);

    const output = logs.join("\n");
    expect(output).toContain("clisbot loops status --channel slack --target group:C1 --thread-id 100");
    expect(output).toContain("sessionKey: `agent:default:slack:channel:c1:thread:100`");
    expect(output).toContain("activeLoops.session: `1`");
    expect(output).toContain("activeLoops.global: `2`");
    expect(output).toContain("loop123");
    expect(output).not.toContain("loop456");
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
      "every",
      "day",
      "at",
      "07:00",
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
      { loops?: Array<{ id: string; kind?: string; promptSummary?: string }> }
    >;
    const sessionEntry = createdStore["agent:default:slack:channel:c1:thread:100"];
    expect(sessionEntry?.loops).toHaveLength(1);
    expect(sessionEntry?.loops?.[0]?.kind).toBe("calendar");
    expect(sessionEntry?.loops?.[0]?.promptSummary).toBe("check CI");

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
  });

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
      "-1001",
      "--topic-id",
      "42",
      "every",
      "weekday",
      "at",
      "07:00",
      "standup",
      "--confirm",
    ]);

    const output = logs.join("\n");
    expect(output).toContain("Started loop `");
    expect(output).toContain("cancel: `clisbot loops cancel --channel telegram --target -1001 --topic-id 42 ");

    const createdStore = JSON.parse(readFileSync(storePath, "utf8")) as Record<
      string,
      { loops?: Array<{ kind?: string; promptSummary?: string }> }
    >;
    expect(createdStore["agent:default:telegram:group:-1001:topic:42"]?.loops).toHaveLength(1);
    expect(createdStore["agent:default:telegram:group:-1001:topic:42"]?.loops?.[0]?.kind).toBe("calendar");
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
    expect(String(slackCalls[0]?.payload.text ?? "")).toContain("Managed loop thread created.");

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
