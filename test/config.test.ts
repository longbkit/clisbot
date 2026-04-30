import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentService } from "../src/agents/agent-service.ts";
import { resolveTelegramConversationRoute } from "../src/channels/telegram/route-config.ts";
import { INTERACTIVE_CLI_STARTUP_DELAY_MS } from "../src/config/agent-tool-presets.ts";
import { readEditableConfig } from "../src/config/config-file.ts";
import { loadConfig, loadConfigWithoutEnvResolution } from "../src/config/load-config.ts";
import { resolveSlackBotConfig } from "../src/config/channel-bots.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";

function buildTemplateConfig() {
  return JSON.parse(
    renderDefaultConfigTemplate({
      slackEnabled: true,
      telegramEnabled: true,
    }),
  ) as Record<string, any>;
}

describe("loadConfig", () => {
  let tempDir = "";
  const originalClisbotHome = process.env.CLISBOT_HOME;
  const originalSlackAppToken = process.env.SLACK_APP_TOKEN;
  const originalSlackBotToken = process.env.SLACK_BOT_TOKEN;
  const originalTelegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalWarn = console.warn;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
    process.env.CLISBOT_HOME = originalClisbotHome;
    process.env.SLACK_APP_TOKEN = originalSlackAppToken;
    process.env.SLACK_BOT_TOKEN = originalSlackBotToken;
    process.env.TELEGRAM_BOT_TOKEN = originalTelegramBotToken;
    console.warn = originalWarn;
  });

  test("loads the new config shape and expands env-backed bot credentials", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = buildTemplateConfig();
    expect(config.agents.defaults.runner.codex.startupReadyPattern).toBeUndefined();
    expect(config.agents.defaults.runner.gemini.startupReadyPattern).toBeUndefined();
    expect(config.app.control.runtimeMonitor.restartBackoff).toBeUndefined();

    config.app.session.mainKey = "main";
    config.app.session.identityLinks = {
      alice: ["slack:U123"],
    };
    config.app.control.configReload.watchDebounceMs = 500;
    config.app.control.sessionCleanup.intervalMinutes = 7;
    config.bots.defaults.dmScope = "main";
    config.bots.slack.defaults.ackReaction = ":eyes:";
    config.bots.slack.defaults.typingReaction = ":hourglass_flowing_sand:";
    config.bots.slack.defaults.processingStatus = {
      enabled: true,
      status: "Summarizing findings...",
      loadingMessages: ["Reviewing context...", "Preparing response..."],
    };
    config.bots.slack.defaults.commandPrefixes = {
      slash: ["::", "\\"],
      bash: ["!"],
    };
    config.bots.slack.defaults.followUp = {
      mode: "auto",
      participationTtlMin: 13,
    };
    config.bots.slack.default.dmPolicy = "allowlist";
    config.bots.slack.default.directMessages = {
      "*": {
        enabled: true,
        requireMention: false,
        policy: "allowlist",
        allowUsers: ["U999"],
        blockUsers: ["U555"],
        allowBots: false,
      },
      U123: {
        responseMode: "message-tool",
        additionalMessageMode: "queue",
      },
    };
    config.agents.defaults.runner.defaults.tmux.socketPath = "~/.clisbot/state/test.sock";
    config.agents.defaults.runner.defaults.stream.maxRuntimeSec = 10;
    config.agents.defaults.runner.defaults.stream.maxRuntimeMin = undefined;
    config.agents.defaults.runner.codex.startupReadyPattern = "ready";
    config.agents.defaults.runner.codex.startupRetryCount = 3;
    config.agents.defaults.runner.codex.startupRetryDelayMs = 250;
    config.agents.defaults.runner.codex.startupBlockers = [
      {
        pattern: "blocked",
        message: "blocked message",
      },
    ];
    config.agents.defaults.runner.codex.sessionId.resume = {
      mode: "command",
      args: ["resume", "{sessionId}", "-C", "{workspace}"],
    };
    config.agents.list = [{ id: "default" }];

    await Bun.write(configPath, JSON.stringify(config));

    process.env.CLISBOT_HOME = tempDir;
    process.env.SLACK_APP_TOKEN = "app-token";
    process.env.SLACK_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";

    const loaded = await loadConfig(configPath);
    const resolvedSlackBot = resolveSlackBotConfig(loaded.raw.bots.slack, "default");

    expect(loaded.raw.bots.slack.default.appToken).toBe("app-token");
    expect(loaded.raw.bots.slack.default.botToken).toBe("bot-token");
    expect(loaded.raw.bots.telegram.default.botToken).toBe("telegram-token");
    expect(loaded.raw.control.configReload.watch).toBe(true);
    expect(loaded.raw.control.configReload.watchDebounceMs).toBe(500);
    expect(loaded.raw.control.sessionCleanup.intervalMinutes).toBe(7);
    expect(loaded.raw.tmux.socketPath.endsWith("test.sock")).toBe(true);
    expect(loaded.raw.session.mainKey).toBe("main");
    expect(loaded.raw.session.dmScope).toBe("main");
    expect(loaded.raw.session.identityLinks.alice).toEqual(["slack:U123"]);
    expect(resolvedSlackBot.ackReaction).toBe(":eyes:");
    expect(resolvedSlackBot.typingReaction).toBe(":hourglass_flowing_sand:");
    expect(resolvedSlackBot.processingStatus.status).toBe("Summarizing findings...");
    expect(resolvedSlackBot.processingStatus.loadingMessages).toEqual([
      "Reviewing context...",
      "Preparing response...",
    ]);
    expect(resolvedSlackBot.commandPrefixes).toEqual({
      slash: ["::", "\\"],
      bash: ["!"],
    });
    expect(resolvedSlackBot.followUp.mode).toBe("auto");
    expect(resolvedSlackBot.followUp.participationTtlMin).toBe(13);
    expect(resolvedSlackBot.directMessages["*"]?.policy).toBe("allowlist");
    expect(resolvedSlackBot.directMessages["*"]?.allowUsers).toEqual(["U999"]);
    expect(resolvedSlackBot.directMessages["*"]?.blockUsers).toEqual(["U555"]);
    expect(resolvedSlackBot.directMessages["U123"]?.policy).toBe("pairing");
    expect(resolvedSlackBot.directMessages["U123"]?.allowUsers).toEqual([]);
    expect(resolvedSlackBot.directMessages["U123"]?.responseMode).toBe("message-tool");
    expect(resolvedSlackBot.directMessages["U123"]?.additionalMessageMode).toBe("queue");
    expect(loaded.raw.agents.defaults.runner.codex.sessionId!.capture.mode).toBe(
      "status-command",
    );
    expect(loaded.raw.agents.defaults.runner.codex.startupReadyPattern).toBe("ready");
    expect(loaded.raw.agents.defaults.runner.codex.startupRetryCount).toBe(3);
    expect(loaded.raw.agents.defaults.runner.codex.startupRetryDelayMs).toBe(250);
    expect(loaded.raw.agents.defaults.runner.codex.startupBlockers).toEqual([
      {
        pattern: "blocked",
        message: "blocked message",
      },
    ]);
    expect(loaded.raw.agents.defaults.runner.codex.sessionId!.resume.mode).toBe("command");
  });

  test("defaults queue limits without pinning them into the generated config template", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-queue-"));
    const configPath = join(tempDir, "clisbot.json");
    const rawTemplate = JSON.parse(renderDefaultConfigTemplate()) as Record<string, any>;
    expect(rawTemplate.app.control.queue).toBeUndefined();

    rawTemplate.app.session.storePath = join(tempDir, "sessions.json");
    rawTemplate.agents.defaults.runner.defaults.tmux.socketPath = join(tempDir, "clisbot.sock");
    rawTemplate.agents.list = [{ id: "default" }];
    await Bun.write(configPath, JSON.stringify(rawTemplate));

    const loaded = await loadConfigWithoutEnvResolution(configPath);
    expect(loaded.raw.control.queue.maxPendingItemsPerSession).toBe(20);
  });

  test("applies codex session-id defaults when the codex family omits sessionId", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = buildTemplateConfig();

    config.agents.defaults.runner.codex = {
      command: "codex",
      args: ["-C", "{workspace}"],
    };

    await Bun.write(configPath, JSON.stringify(config));

    process.env.SLACK_APP_TOKEN = "app-token";
    process.env.SLACK_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";

    const loaded = await loadConfig(configPath);
    const resolvedDefaultAgent = new AgentService(loaded).getResolvedAgentConfig("default");

    expect(resolvedDefaultAgent.runner.sessionId.create.mode).toBe("runner");
    expect(resolvedDefaultAgent.runner.sessionId.capture.mode).toBe("status-command");
    expect(resolvedDefaultAgent.runner.sessionId.resume.mode).toBe("command");
    expect(resolvedDefaultAgent.runner.startupReadyPattern).toBe("(?:^|\\s)›\\s");
  });

  test("migrates released 0.1.43 route keys into the new canonical surface shape", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = buildTemplateConfig();

    config.meta.schemaVersion = "0.1.43";
    delete config.app.timezone;
    config.app.control.loop.defaultTimezone = "Asia/Ho_Chi_Minh";
    config.bots.defaults.timezone = "UTC";
    delete config.bots.slack.default.dmPolicy;
    config.bots.slack.defaults.directMessages = {
      "dm:*": {
        enabled: true,
        policy: "pairing",
        allowUsers: [],
        blockUsers: [],
        allowBots: false,
      },
    };
    config.bots.slack.default.directMessages = {
      "dm:*": {
        enabled: true,
        policy: "allowlist",
        allowUsers: ["U_OWNER"],
        blockUsers: [],
        allowBots: false,
      },
      "dm:U_DEV": {
        enabled: false,
        policy: "disabled",
        allowUsers: ["U_DEV"],
        responseMode: "capture-pane",
      },
    };
    config.bots.slack.default.groups = {
      "groups:*": {
        enabled: false,
        policy: "disabled",
        allowUsers: [],
        blockUsers: [],
        allowBots: false,
      },
      "channel:C123": {
        enabled: true,
        policy: "allowlist",
        allowUsers: ["U_DEVOPS"],
        blockUsers: [],
        allowBots: false,
      },
    };

    await Bun.write(configPath, JSON.stringify(config));

    process.env.SLACK_APP_TOKEN = "app-token";
    process.env.SLACK_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    const warnings: string[] = [];
    console.warn = ((message?: unknown) => {
      warnings.push(String(message ?? ""));
    }) as typeof console.warn;

    const loaded = await loadConfigWithoutEnvResolution(configPath);

    expect(loaded.raw.meta.schemaVersion).toBe("0.1.45");
    expect(loaded.raw.app.timezone).toBe("Asia/Ho_Chi_Minh");
    expect(loaded.raw.app.control.loop.defaultTimezone).toBeUndefined();
    expect(loaded.raw.bots.defaults.timezone).toBeUndefined();
    expect(loaded.raw.bots.slack.defaults.timezone).toBeUndefined();
    expect(loaded.raw.bots.telegram.defaults.timezone).toBeUndefined();
    expect(loaded.raw.bots.slack.default.directMessages["*"]?.policy).toBe("allowlist");
    expect(loaded.raw.bots.slack.default.directMessages["U_DEV"]?.enabled).toBe(true);
    expect(loaded.raw.bots.slack.default.directMessages["U_DEV"]?.policy).toBe("pairing");
    expect(loaded.raw.bots.slack.default.directMessages["U_DEV"]?.allowUsers).toEqual([]);
    expect(loaded.raw.bots.slack.default.directMessages["U_DEV"]?.responseMode).toBe(
      "capture-pane",
    );
    expect(loaded.raw.bots.slack.default.groupPolicy).toBe("allowlist");
    expect(loaded.raw.bots.slack.default.groups["*"]?.policy).toBe("open");
    expect(loaded.raw.bots.slack.default.groups["C123"]?.policy).toBe("allowlist");
    expect(loaded.raw.bots.slack.default.groups["C123"]?.allowUsers).toEqual(["U_DEVOPS"]);

    const rewrittenConfig = JSON.parse(readFileSync(configPath, "utf8"));
    const backups = readdirSync(join(tempDir, "backups"));
    expect(rewrittenConfig.meta.schemaVersion).toBe("0.1.45");
    expect(rewrittenConfig.app.timezone).toBe("Asia/Ho_Chi_Minh");
    expect(rewrittenConfig.app.control.loop.defaultTimezone).toBeUndefined();
    expect(rewrittenConfig.bots.defaults.timezone).toBeUndefined();
    expect(rewrittenConfig.bots.slack.defaults.timezone).toBeUndefined();
    expect(rewrittenConfig.bots.telegram.defaults.timezone).toBeUndefined();
    expect(rewrittenConfig.bots.slack.default.groups["*"].policy).toBe("open");
    expect(backups).toHaveLength(1);
    expect(backups[0]).toContain("clisbot.json.0.1.43.");
    const backupConfig = JSON.parse(readFileSync(join(tempDir, "backups", backups[0]!), "utf8"));
    expect(backupConfig.meta.schemaVersion).toBe("0.1.43");
    expect(backupConfig.bots.slack.default.groups["groups:*"].policy).toBe("disabled");
    expect(warnings).toEqual([
      expect.stringContaining("backup 0.1.43 config to"),
      "clisbot config upgrade: preparing 0.1.43 -> 0.1.45",
      "clisbot config upgrade: dry-run validating 0.1.45 config",
      expect.stringContaining("applying 0.1.45 config to"),
      expect.stringContaining("applied 0.1.43 -> 0.1.45; backup:"),
    ]);
  });

  test("migrates legacy exact shared routes without policy to inherit wildcard sender policy", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = buildTemplateConfig();

    config.meta.schemaVersion = "0.1.41";
    delete config.bots.slack.default.groupPolicy;
    delete config.bots.slack.default.channelPolicy;
    delete config.bots.telegram.default.groupPolicy;
    config.bots.slack.default.groups = {
      C1234567890: {
        enabled: true,
        requireMention: true,
        allowUsers: [],
        blockUsers: [],
        allowBots: false,
      },
    };
    config.bots.telegram.default.groups = {
      "-1001234567890": {
        enabled: true,
        requireMention: false,
        allowUsers: [],
        blockUsers: [],
        allowBots: false,
        topics: {
          "42": {
            enabled: true,
            allowUsers: [],
            blockUsers: [],
            streaming: "all",
          },
        },
      },
    };

    await Bun.write(configPath, JSON.stringify(config));

    const loaded = await loadConfigWithoutEnvResolution(configPath);

    expect(loaded.raw.bots.slack.default.groupPolicy).toBe("allowlist");
    expect(loaded.raw.bots.slack.default.channelPolicy).toBe("allowlist");
    expect(loaded.raw.bots.slack.default.groups.C1234567890?.policy).toBeUndefined();
    expect(loaded.raw.bots.telegram.default.groupPolicy).toBe("allowlist");
    expect(loaded.raw.bots.telegram.default.groups["*"]?.policy).toBe("open");
    expect(loaded.raw.bots.telegram.default.groups["-1001234567890"]?.policy).toBeUndefined();
    expect(
      loaded.raw.bots.telegram.default.groups["-1001234567890"]?.topics["42"]?.policy,
    ).toBeUndefined();

    const resolved = resolveTelegramConversationRoute({
      loadedConfig: loaded,
      chatType: "supergroup",
      chatId: -1001234567890,
      topicId: 42,
      isForum: true,
      botId: "default",
    });

    expect(resolved.status).toBe("admitted");
    expect(resolved.route?.policy).toBe("open");
  });

  test("migrates 0.1.44 timezone defaults into app timezone", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = buildTemplateConfig();

    config.meta.schemaVersion = "0.1.44";
    delete config.app.timezone;
    config.bots.defaults.timezone = "Asia/Ho_Chi_Minh";
    config.bots.slack.defaults.timezone = "America/Los_Angeles";
    config.bots.telegram.defaults.timezone = "Asia/Singapore";
    config.bots.telegram.default.timezone = "Asia/Tokyo";

    await Bun.write(configPath, JSON.stringify(config));

    const loaded = await loadConfigWithoutEnvResolution(configPath);
    const rewrittenConfig = JSON.parse(readFileSync(configPath, "utf8"));
    const backups = readdirSync(join(tempDir, "backups"));

    expect(loaded.raw.meta.schemaVersion).toBe("0.1.45");
    expect(loaded.raw.app.timezone).toBe("Asia/Ho_Chi_Minh");
    expect(loaded.raw.bots.defaults.timezone).toBeUndefined();
    expect(loaded.raw.bots.slack.defaults.timezone).toBeUndefined();
    expect(loaded.raw.bots.telegram.defaults.timezone).toBeUndefined();
    expect(loaded.raw.bots.telegram.default.timezone).toBe("Asia/Tokyo");
    expect(rewrittenConfig.app.timezone).toBe("Asia/Ho_Chi_Minh");
    expect(rewrittenConfig.bots.telegram.default.timezone).toBe("Asia/Tokyo");
    expect(backups).toHaveLength(1);
    expect(backups[0]).toContain("clisbot.json.0.1.44.");
  });

  test("clears runner-owned startup defaults during 0.1.45 config upgrade", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = buildTemplateConfig();

    config.meta.schemaVersion = "0.1.44";
    config.agents.defaults.runner.defaults.startupDelayMs = 12345;
    config.app.control.runtimeMonitor.restartBackoff = {
      fastRetry: {
        delaySeconds: 10,
        maxRestarts: 3,
      },
      stages: [
        {
          delayMinutes: 15,
          maxRestarts: 4,
        },
        {
          delayMinutes: 30,
          maxRestarts: 4,
        },
      ],
    };
    config.agents.defaults.runner.codex.startupDelayMs = 12345;
    config.agents.defaults.runner.codex.startupReadyPattern = "custom-codex-ready";
    config.agents.defaults.runner.gemini.startupDelayMs = 12345;
    config.agents.defaults.runner.gemini.startupRetryCount = 7;
    config.agents.defaults.runner.gemini.startupRetryDelayMs = 4321;
    config.agents.defaults.runner.gemini.startupReadyPattern = "custom-gemini-ready";
    config.agents.defaults.runner.gemini.startupBlockers = [
      {
        pattern: "custom-blocker",
        message: "custom blocker",
      },
    ];
    config.agents.defaults.runner.gemini.promptSubmitDelayMs = 999;

    await Bun.write(configPath, JSON.stringify(config));

    const loaded = await loadConfigWithoutEnvResolution(configPath);
    const rewrittenConfig = JSON.parse(readFileSync(configPath, "utf8"));
    const resolvedDefaultAgent = new AgentService(loaded).getResolvedAgentConfig("default");

    expect(rewrittenConfig.app.control.runtimeMonitor.restartBackoff).toBeUndefined();
    expect(rewrittenConfig.agents.defaults.runner.defaults.startupDelayMs).toBeUndefined();
    expect(rewrittenConfig.agents.defaults.runner.codex.startupDelayMs).toBeUndefined();
    expect(rewrittenConfig.agents.defaults.runner.codex.startupReadyPattern).toBeUndefined();
    expect(rewrittenConfig.agents.defaults.runner.gemini.startupDelayMs).toBeUndefined();
    expect(rewrittenConfig.agents.defaults.runner.gemini.startupRetryCount).toBeUndefined();
    expect(rewrittenConfig.agents.defaults.runner.gemini.startupRetryDelayMs).toBeUndefined();
    expect(rewrittenConfig.agents.defaults.runner.gemini.startupReadyPattern).toBeUndefined();
    expect(rewrittenConfig.agents.defaults.runner.gemini.startupBlockers).toBeUndefined();
    expect(rewrittenConfig.agents.defaults.runner.gemini.promptSubmitDelayMs).toBeUndefined();
    expect(resolvedDefaultAgent.runner.startupReadyPattern).toBe("(?:^|\\s)›\\s");
    expect(resolvedDefaultAgent.runner.startupDelayMs).toBe(INTERACTIVE_CLI_STARTUP_DELAY_MS);
  });

  test("clears stale current-schema shared startup defaults on load", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = buildTemplateConfig();

    config.meta.schemaVersion = "0.1.45";
    config.agents.defaults.runner.defaults.startupDelayMs = 3000;
    config.agents.defaults.runner.codex.startupDelayMs = 3000;

    await Bun.write(configPath, JSON.stringify(config));

    const loaded = await loadConfigWithoutEnvResolution(configPath);
    const rewrittenConfig = JSON.parse(readFileSync(configPath, "utf8"));
    const backups = readdirSync(join(tempDir, "backups"));
    const resolvedDefaultAgent = new AgentService(loaded).getResolvedAgentConfig("default");

    expect(rewrittenConfig.meta.schemaVersion).toBe("0.1.45");
    expect(rewrittenConfig.agents.defaults.runner.defaults.startupDelayMs).toBeUndefined();
    expect(rewrittenConfig.agents.defaults.runner.codex.startupDelayMs).toBeUndefined();
    expect(resolvedDefaultAgent.runner.startupDelayMs).toBe(INTERACTIVE_CLI_STARTUP_DELAY_MS);
    expect(backups).toHaveLength(1);
    expect(backups[0]).toContain("clisbot.json.0.1.45.");
  });

  test("preserves current-schema disabled wildcard sender policy", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = buildTemplateConfig();
    config.bots.telegram.default.groups["*"] = {
      enabled: false,
      policy: "disabled",
      requireMention: true,
      allowUsers: [],
      blockUsers: [],
      allowBots: false,
      topics: {},
    };

    await Bun.write(configPath, JSON.stringify(config));
    const warnings: string[] = [];
    console.warn = ((message?: unknown) => {
      warnings.push(String(message ?? ""));
    }) as typeof console.warn;

    const loaded = await loadConfigWithoutEnvResolution(configPath);

    expect(loaded.raw.bots.telegram.default.groupPolicy).toBe("allowlist");
    expect(loaded.raw.bots.telegram.default.groups["*"]?.enabled).toBe(false);
    expect(loaded.raw.bots.telegram.default.groups["*"]?.policy).toBe("disabled");
    expect(warnings).toEqual([]);
  });

  test("rejects legacy privilegeCommands config keys", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = buildTemplateConfig();
    config.app.privilegeCommands = {
      enabled: true,
    };
    await Bun.write(configPath, JSON.stringify(config));

    await expect(loadConfig(configPath)).rejects.toThrow("privilegeCommands");
    await expect(loadConfigWithoutEnvResolution(configPath)).rejects.toThrow(
      "privilegeCommands",
    );
  });

  test("does not require token env vars for disabled providers", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = buildTemplateConfig();

    config.bots.slack.defaults.enabled = false;
    config.bots.slack.default.enabled = false;
    config.bots.telegram.defaults.enabled = false;
    config.bots.telegram.default.enabled = false;

    await Bun.write(configPath, JSON.stringify(config));

    delete process.env.SLACK_APP_TOKEN;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;

    const loaded = await loadConfig(configPath);
    expect(loaded.raw.bots.slack.defaults.enabled).toBe(false);
    expect(loaded.raw.bots.telegram.defaults.enabled).toBe(false);
  });

  test("uses CLISBOT_HOME for dynamic default paths", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    const configPath = join(tempDir, "clisbot.json");
    process.env.CLISBOT_HOME = "~/.clisbot-dev";

    const config = buildTemplateConfig();
    delete config.app.session.storePath;
    delete config.agents.defaults.workspace;
    delete config.agents.defaults.runner.defaults.tmux.socketPath;

    await Bun.write(configPath, JSON.stringify(config));

    process.env.SLACK_APP_TOKEN = "app-token";
    process.env.SLACK_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";

    const loaded = await loadConfig(configPath);

    expect(loaded.raw.session.storePath).toBe(
      join(homedir(), ".clisbot-dev", "state", "sessions.json"),
    );
    expect(loaded.raw.tmux.socketPath).toBe(
      join(homedir(), ".clisbot-dev", "state", "clisbot.sock"),
    );
    expect(loaded.raw.agents.defaults.workspace).toBe(
      join(homedir(), ".clisbot-dev", "workspaces", "{agentId}"),
    );
  });

  test("uses CLISBOT_HOME for editable config defaults too", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    process.env.CLISBOT_HOME = tempDir;
    const configPath = join(tempDir, "editable", "clisbot.json");

    const editable = await readEditableConfig(configPath);

    expect(editable.config.app.session.storePath).toBe(`${tempDir}/state/sessions.json`);
    expect(editable.config.agents.defaults.runner.defaults.tmux.socketPath).toBe(
      `${tempDir}/state/clisbot.sock`,
    );
    expect(editable.config.agents.defaults.workspace).toBe(
      `${tempDir}/workspaces/{agentId}`,
    );
  });
});
