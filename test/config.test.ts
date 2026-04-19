import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentService } from "../src/agents/agent-service.ts";
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

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
    process.env.CLISBOT_HOME = originalClisbotHome;
    process.env.SLACK_APP_TOKEN = originalSlackAppToken;
    process.env.SLACK_BOT_TOKEN = originalSlackBotToken;
    process.env.TELEGRAM_BOT_TOKEN = originalTelegramBotToken;
  });

  test("loads the new config shape and expands env-backed bot credentials", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = buildTemplateConfig();

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
    expect(resolvedSlackBot.directMessages["dm:*"]?.policy).toBe("allowlist");
    expect(resolvedSlackBot.directMessages["dm:*"]?.allowUsers).toEqual(["U999"]);
    expect(resolvedSlackBot.directMessages["dm:*"]?.blockUsers).toEqual(["U555"]);
    expect(resolvedSlackBot.directMessages["dm:U123"]?.policy).toBeUndefined();
    expect(resolvedSlackBot.directMessages["dm:U123"]?.allowUsers).toEqual([]);
    expect(resolvedSlackBot.directMessages["dm:U123"]?.responseMode).toBe("message-tool");
    expect(resolvedSlackBot.directMessages["dm:U123"]?.additionalMessageMode).toBe("queue");
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

    expect(loaded.raw.session.storePath).toBe("/home/node/.clisbot-dev/state/sessions.json");
    expect(loaded.raw.tmux.socketPath).toBe("/home/node/.clisbot-dev/state/clisbot.sock");
    expect(loaded.raw.agents.defaults.workspace).toBe(
      "/home/node/.clisbot-dev/workspaces/{agentId}",
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
