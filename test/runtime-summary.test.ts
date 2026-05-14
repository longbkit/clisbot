import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityStore } from "../src/control/runtime/activity-store.ts";
import { describeSlackStartupFailure } from "../src/channels/slack/startup-failure.ts";
import { RuntimeHealthStore } from "../src/control/runtime/runtime-health-store.ts";
import {
  getRuntimeOperatorSummary,
  renderStartSummary,
  renderStatusSummary,
  type RuntimeOperatorSummary,
} from "../src/control/runtime/runtime-summary.ts";
import { writeEditableConfig } from "../src/config/core/config-file.ts";
import { clisbotConfigSchema } from "../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/core/template.ts";
import { setRenderedCliName } from "../src/control/commands/cli-name.ts";

describe("runtime summaries", () => {
  let tempDir = "";
  let previousCliName: string | undefined;
  const originalClisbotHome = process.env.CLISBOT_HOME;
  const originalSlackAppToken = process.env.SLACK_APP_TOKEN;
  const originalSlackBotToken = process.env.SLACK_BOT_TOKEN;
  const originalTelegramBotToken = process.env.TELEGRAM_BOT_TOKEN;

  beforeEach(() => {
    previousCliName = process.env.CLISBOT_CLI_NAME;
    delete process.env.CLISBOT_CLI_NAME;
    setRenderedCliName();
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    process.env.CLISBOT_CLI_NAME = previousCliName;
    setRenderedCliName(previousCliName);
    process.env.CLISBOT_HOME = originalClisbotHome;
    process.env.SLACK_APP_TOKEN = originalSlackAppToken;
    process.env.SLACK_BOT_TOKEN = originalSlackBotToken;
    process.env.TELEGRAM_BOT_TOKEN = originalTelegramBotToken;
  });

  test("renders first-run guidance when no agents exist", async () => {
    delete process.env.CLISBOT_HOME;
    process.env.SLACK_APP_TOKEN = "app";
    process.env.SLACK_BOT_TOKEN = "bot";
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-summary-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = clisbotConfigSchema.parse(
      JSON.parse(
        renderDefaultConfigTemplate({
          channels: {
            slack: { enabled: true },
            telegram: { enabled: true },
          },
        }),
      ),
    );
    await writeEditableConfig(configPath, config);

    const summary = await getRuntimeOperatorSummary({
      configPath,
      runtimeRunning: false,
    });
    const text = renderStartSummary(summary);

    expect(text).toContain("No agents are configured yet.");
    expect(text).toContain("First run requires both `--cli` and `--bot-type`.");
    expect(text).toContain("personal = one assistant for one human.");
    expect(text).toContain("team = one shared assistant for a team or channel.");
    expect(text).toContain("clisbot start --cli codex --bot-type personal");
    expect(text).toContain("Help: clisbot --help");
  });

  test("renders CLISBOT_HOME-derived paths in operator guidance", async () => {
    process.env.CLISBOT_HOME = "~/.clisbot-dev";
    process.env.TELEGRAM_BOT_TOKEN = "telegram";
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-summary-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = clisbotConfigSchema.parse(
      JSON.parse(
        renderDefaultConfigTemplate({
          channels: {
            slack: { enabled: false },
            telegram: { enabled: true },
          },
        }),
      ),
    );
    config.agents.list = [
      {
        id: "default",
        cli: "codex",
      },
    ];
    await writeEditableConfig(configPath, config);

    const summary = await getRuntimeOperatorSummary({
      configPath,
      runtimeRunning: false,
    });
    const text = renderStartSummary(summary);

    expect(text).toContain("DM the Telegram bot first to confirm it responds normally");
    expect(text).toContain("clisbot routes add --channel telegram group:<chatId> --bot default");
    expect(text).toContain("clisbot routes set-agent --channel telegram group:<chatId> --bot default --agent <id>");
    expect(text).toContain("tmux -S ~/.clisbot-dev/state/clisbot.sock list-sessions");
    expect(text).toContain("tmux -S ~/.clisbot-dev/state/clisbot.sock attach -t <session-name>");
  });

  test("renders disabled provider summaries when legacy configs omit provider bot records", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-summary-"));
    const cases = [
      {
        channel: "slack",
        botKey: "slack",
        staleSummary: "stale Slack health",
      },
      {
        channel: "telegram",
        botKey: "telegram",
        staleSummary: "stale Telegram health",
      },
      {
        channel: "zalo-bot",
        botKey: "zaloBot",
        staleSummary: "stale Zalo Bot health",
      },
    ] as const;

    for (const item of cases) {
      const configPath = join(tempDir, `${item.channel}.json`);
      const healthPath = join(tempDir, `${item.channel}-health.json`);
      const config = JSON.parse(
        renderDefaultConfigTemplate({
          channels: {
            slack: { enabled: false },
            telegram: { enabled: false },
            "zalo-bot": { enabled: false },
          },
        }),
      );
      delete config.bots[item.botKey];
      config.agents.list = [{ id: "default", cli: "codex" }];
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const healthStore = new RuntimeHealthStore(healthPath);
      await healthStore.setChannel({
        channel: item.channel,
        connection: "active",
        summary: item.staleSummary,
      });

      const summary = await getRuntimeOperatorSummary({
        configPath,
        runtimeRunning: true,
        healthPath,
      });
      const text = renderStatusSummary(summary);

      expect(text).toContain(`${item.channel} enabled=no`);
      expect(text).not.toContain(item.staleSummary);
    }
  });

  test("fails loudly when an enabled provider omits its default bot record", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-summary-"));
    const cases = [
      { channel: "slack", botKey: "slack", error: "Unknown Slack bot: default" },
      { channel: "telegram", botKey: "telegram", error: "Unknown Telegram bot: default" },
      { channel: "zalo-bot", botKey: "zaloBot", error: "Unknown Zalo Bot bot: default" },
    ] as const;

    for (const item of cases) {
      const configPath = join(tempDir, `${item.channel}-enabled.json`);
      const config = JSON.parse(
        renderDefaultConfigTemplate({
          channels: {
            slack: { enabled: false },
            telegram: { enabled: false },
            "zalo-bot": { enabled: false },
            [item.channel]: { enabled: true },
          },
        }),
      );
      delete config.bots[item.botKey].default;
      config.agents.list = [{ id: "default", cli: "codex" }];
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      await expect(getRuntimeOperatorSummary({
        configPath,
        runtimeRunning: true,
      })).rejects.toThrow(item.error);
    }
  });

  test("renders channel setup commands with the active CLI name", async () => {
    setRenderedCliName("clisbot-dev");
    process.env.CLISBOT_HOME = "~/.clisbot-dev";
    process.env.TELEGRAM_BOT_TOKEN = "telegram";
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-summary-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = clisbotConfigSchema.parse(
      JSON.parse(
        renderDefaultConfigTemplate({
          channels: {
            slack: { enabled: false },
            telegram: { enabled: true },
          },
        }),
      ),
    );
    config.agents.list = [{ id: "default", cli: "codex" }];
    await writeEditableConfig(configPath, config);

    const summary = await getRuntimeOperatorSummary({
      configPath,
      runtimeRunning: false,
    });
    const text = renderStatusSummary(summary);

    expect(text).toContain("add group: `clisbot-dev routes add --channel telegram group:<chatId> --bot default`");
    expect(text).toContain("clisbot-dev routes set-agent --channel telegram group:<chatId> --bot default --agent <id>");
    expect(text).not.toContain("add group: `clisbot routes add --channel telegram group:<chatId> --bot default`");
  });

  test("renders agent and channel activity in status output", async () => {
    delete process.env.CLISBOT_HOME;
    process.env.SLACK_APP_TOKEN = "app";
    process.env.SLACK_BOT_TOKEN = "bot";
    process.env.TELEGRAM_BOT_TOKEN = "telegram";
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-summary-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = clisbotConfigSchema.parse(
      JSON.parse(
        renderDefaultConfigTemplate({
          channels: {
            slack: { enabled: true },
            telegram: { enabled: true },
          },
        }),
      ),
    );
    config.agents.list = [
      {
        id: "work",
        cli: "codex",
        workspace: join(tempDir, "workspaces", "work"),
        bootstrap: {
          botType: "team-assistant",
        },
      },
    ];
    config.bots.slack.default.agentId = "work";
    await writeEditableConfig(configPath, config);

    const activityStore = new ActivityStore(join(tempDir, "activity.json"));
    await activityStore.record({
      agentId: "work",
      channel: "slack",
      surface: "channel:C123",
    });

    const summary = await getRuntimeOperatorSummary({
      configPath,
      runtimeRunning: false,
      activityPath: join(tempDir, "activity.json"),
    });
    const text = renderStatusSummary(summary);
    const startText = renderStartSummary(summary);

    expect(text).toContain("agents=1");
    expect(text).toContain("Owner:");
    expect(text).toContain("configured=no principals=none claimWindow=30m");
    expect(text).toContain("implicit admin across all agents/channels");
    expect(text).toContain("work tool=codex");
    expect(text).toContain("slack enabled=yes");
    expect(text).toContain("responseMode=message-tool");
    expect(text).toContain("additionalMessageMode=steer");
    expect(text).toContain("Channel health:");
    expect(text).toContain("dm=pairing");
    expect(text).toContain("sharedDefault=open");
    expect(text).toContain("routes=none");
    expect(text).toContain("telegram: no explicit group or topic routes are configured yet");
    expect(startText).toContain("telegram: no explicit group or topic routes are configured yet");
    expect(startText).toContain("DM one enabled bot first to confirm it responds normally (Telegram, Slack)");
    expect(startText).toContain("after DM works, add the bot to the target routed multi-user surface");
    expect(startText).toContain("then add the route on the channel you want to expose:");
    expect(startText).toContain("Telegram: add group: `clisbot routes add --channel telegram group:<chatId> --bot default`");
    expect(startText).toContain("Telegram: add topic: `clisbot routes add --channel telegram topic:<chatId>:<topicId> --bot default`");
    expect(startText).toContain("Slack: add group: `clisbot routes add --channel slack group:<channelId> --bot default`");
    expect(startText).toContain("each route uses the agent currently assigned to that bot by default");
    expect(startText).toContain("only if one route should use a different agent, bind it with the matching `clisbot routes set-agent ...` command for that channel");
    expect(startText).toContain(
      "Telegram: send `/start` in the target DM, group, or topic to get onboarding or pairing guidance",
    );
    expect(startText).toContain(
      "Slack: mention `@<botname> \\start` in the target channel to verify mention flow",
    );
    expect(startText).toContain(
      "Send a direct message (DM) to the Telegram bot. Send `/start` or `hi` to receive a pairing code.",
    );
    expect(startText).toContain(
      "Send a direct message (DM) to the Slack bot. Say `hi` to receive a pairing code.",
    );
    expect(startText).toContain("Auth onboarding:");
    expect(startText).toContain("if DM pairing is enabled for that channel, pair first before expecting DM access");
    expect(startText).toContain("the first DM user during the first 30 minutes becomes app owner automatically");
    expect(startText).toContain("clisbot auth add-user app --role <owner|admin> --user <principal>");
    expect(startText).toContain("clisbot auth add-permission ...");
    expect(startText).toContain("clisbot auth --help");
    expect(startText).toContain("clisbot pairing approve telegram <code>");
    expect(startText).toContain("clisbot pairing approve slack <code>");
    expect(startText).toContain("Configured app owner/admin principals bypass pairing in DMs.");
    expect(startText).toContain("If no owner is configured yet, the first DM user during the first 30 minutes becomes app owner automatically.");
    expect(startText).toContain("tmux -S ~/.clisbot/state/clisbot.sock list-sessions");
    expect(startText).toContain("tmux -S ~/.clisbot/state/clisbot.sock attach -t <session-name>");
  });

  test("includes zalo-bot in status and start summaries when enabled", async () => {
    delete process.env.CLISBOT_HOME;
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-summary-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = clisbotConfigSchema.parse(
      JSON.parse(
        renderDefaultConfigTemplate({
          channels: {
            slack: { enabled: false },
            telegram: { enabled: false },
            "zalo-bot": { enabled: true },
          },
        }),
      ),
    );
    config.agents.list = [{ id: "default", cli: "codex" }];
    config.bots.zaloBot.defaults.enabled = true;
    config.bots.zaloBot.default.enabled = true;
    config.bots.zaloBot.default.credentialType = "tokenFile";
    config.bots.zaloBot.default.botToken = "";
    await writeEditableConfig(configPath, config);

    const summary = await getRuntimeOperatorSummary({
      configPath,
      runtimeRunning: false,
    });
    const statusText = renderStatusSummary(summary);
    const startText = renderStartSummary(summary);

    expect(statusText).toContain("zalo-bot enabled=yes");
    expect(statusText).toContain("zalo-bot: no explicit group routes are configured yet");
    expect(startText).toContain("DM the Zalo Bot first to confirm it responds normally");
    expect(startText).toContain("routes add --channel zalo-bot group:<chatId> --bot default");
    expect(startText).toContain("routes set-agent --channel zalo-bot group:<chatId> --bot default --agent <id>");
    expect(startText).toContain("Zalo Bot: DM the bot for pairing flow first, then mention it in the target group to verify trigger flow");
    expect(startText).toContain("clisbot pairing approve zalo-bot <code>");
  });

  test("clears lost persisted active runs before operator status output", async () => {
    delete process.env.CLISBOT_HOME;
    process.env.SLACK_APP_TOKEN = "app";
    process.env.SLACK_BOT_TOKEN = "bot";
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-summary-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate({
      channels: {
        slack: { enabled: true },
        telegram: { enabled: false },
      },
    })));
    config.agents.list = [
      {
        id: "work",
        cli: "codex",
      },
    ];
    await writeEditableConfig(configPath, config);

    writeFileSync(
      join(tempDir, "sessions.json"),
      JSON.stringify(
        {
          "agent:work:slack:channel:C123:thread:1.2": {
            agentId: "work",
            sessionKey: "agent:work:slack:channel:C123:thread:1.2",
            workspacePath: join(tempDir, "work"),
            runnerCommand: "codex",
            runtime: {
              state: "detached",
              startedAt: 1_700_000_000_000,
              detachedAt: 1_700_000_060_000,
            },
            updatedAt: 1_700_000_060_000,
          },
        },
        null,
        2,
      ),
    );
    config.app.session.storePath = join(tempDir, "sessions.json");
    await writeEditableConfig(configPath, config);

    const summary = await getRuntimeOperatorSummary({
      configPath,
      runtimeRunning: false,
      activityPath: join(tempDir, "activity.json"),
    });
    const text = renderStatusSummary(summary);

    expect(text).toContain("Active runs:");
    expect(text).toContain("telegram enabled=no");
    expect(text).not.toContain("telegram enabled=no connection=");
    expect(text).toContain("Active runs:\n  none");
    expect(text).not.toContain("agent=work state=detached");
    expect(text).not.toContain("runner=lost");
    const persisted = JSON.parse(readFileSync(config.app.session.storePath, "utf8"));
    expect(persisted["agent:work:slack:channel:C123:thread:1.2"].runtime.state).toBe("idle");
  });

  test("shows only the five most recent runner sessions in status output", () => {
    const summary = {
      loadedConfig: {} as RuntimeOperatorSummary["loadedConfig"],
      ownerSummary: {
        ownerPrincipals: [],
        adminPrincipals: [],
        ownerClaimWindowMinutes: 30,
      },
      timezoneSummary: {
        effective: "UTC",
        source: "app",
        appTimezone: "UTC",
      },
      agentSummaries: [],
      channelSummaries: [],
      activeRuns: [],
      configuredAgents: 0,
      bootstrapPendingAgents: 0,
      bootstrappedAgents: 0,
      runningTmuxSessions: 6,
      runnerSessions: [
        {
          sessionName: "session-6",
          live: true,
          entry: {
            agentId: "default",
            sessionKey: "session-6",
            workspacePath: "/tmp/session-6",
            runnerCommand: "codex",
            lastAdmittedPromptAt: 1_700_000_006_000,
            updatedAt: 1_700_000_006_000,
          },
        },
        {
          sessionName: "session-5",
          live: true,
          entry: {
            agentId: "default",
            sessionKey: "session-5",
            workspacePath: "/tmp/session-5",
            runnerCommand: "codex",
            lastAdmittedPromptAt: 1_700_000_005_000,
            updatedAt: 1_700_000_005_000,
          },
        },
        {
          sessionName: "session-4",
          live: true,
          entry: {
            agentId: "default",
            sessionKey: "session-4",
            workspacePath: "/tmp/session-4",
            runnerCommand: "codex",
            lastAdmittedPromptAt: 1_700_000_004_000,
            updatedAt: 1_700_000_004_000,
          },
        },
        {
          sessionName: "session-3",
          live: true,
          entry: {
            agentId: "default",
            sessionKey: "session-3",
            workspacePath: "/tmp/session-3",
            runnerCommand: "codex",
            lastAdmittedPromptAt: 1_700_000_003_000,
            updatedAt: 1_700_000_003_000,
          },
        },
        {
          sessionName: "session-2",
          live: true,
          entry: {
            agentId: "default",
            sessionKey: "session-2",
            workspacePath: "/tmp/session-2",
            runnerCommand: "codex",
            lastAdmittedPromptAt: 1_700_000_002_000,
            updatedAt: 1_700_000_002_000,
          },
        },
        {
          sessionName: "session-1",
          live: true,
          entry: {
            agentId: "default",
            sessionKey: "session-1",
            workspacePath: "/tmp/session-1",
            runnerCommand: "codex",
            lastAdmittedPromptAt: 1_700_000_001_000,
            updatedAt: 1_700_000_001_000,
          },
        },
      ],
    } satisfies RuntimeOperatorSummary;

    const text = renderStatusSummary(summary);

    expect(text).toContain("Runner sessions:");
    expect(text).toContain("session-6");
    expect(text).toContain("session-2");
    expect(text).not.toContain("session-1");
    expect(text).toContain("(1) sessions more");
    expect(text).toContain("clisbot runner list");
    expect(text).toContain("clisbot watch --latest");
  });

  test("distinguishes missing, not-bootstrapped, and bootstrapped bootstrap states", async () => {
    delete process.env.CLISBOT_HOME;
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-summary-"));
    const configPath = join(tempDir, "clisbot.json");
    const baseWorkspace = join(tempDir, "workspaces");
    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    config.agents.list = [
      {
        id: "codex-missing",
        cli: "codex",
        workspace: join(baseWorkspace, "codex-missing"),
        bootstrap: { botType: "personal-assistant" },
      },
      {
        id: "claude-pending",
        cli: "claude",
        workspace: join(baseWorkspace, "claude-pending"),
        bootstrap: { botType: "team-assistant" },
      },
      {
        id: "codex-ready",
        cli: "codex",
        workspace: join(baseWorkspace, "codex-ready"),
        bootstrap: { botType: "personal-assistant" },
      },
      {
        id: "gemini-ready",
        cli: "gemini",
        workspace: join(baseWorkspace, "gemini-ready"),
        bootstrap: { botType: "team-assistant" },
      },
    ];
    await writeEditableConfig(configPath, config);

    mkdirSync(join(baseWorkspace, "claude-pending"), { recursive: true });
    writeFileSync(join(baseWorkspace, "claude-pending", "AGENTS.md"), "agents\n");
    symlinkSync("AGENTS.md", join(baseWorkspace, "claude-pending", "CLAUDE.md"));
    writeFileSync(join(baseWorkspace, "claude-pending", "IDENTITY.md"), "identity\n");
    writeFileSync(join(baseWorkspace, "claude-pending", "BOOTSTRAP.md"), "bootstrap\n");

    mkdirSync(join(baseWorkspace, "codex-ready"), { recursive: true });
    writeFileSync(join(baseWorkspace, "codex-ready", "AGENTS.md"), "agents\n");
    writeFileSync(join(baseWorkspace, "codex-ready", "IDENTITY.md"), "identity\n");
    writeFileSync(join(baseWorkspace, "codex-ready", "BOOTSTRAP.md"), "bootstrap\n");
    unlinkSync(join(baseWorkspace, "codex-ready", "BOOTSTRAP.md"));

    mkdirSync(join(baseWorkspace, "gemini-ready"), { recursive: true });
    writeFileSync(join(baseWorkspace, "gemini-ready", "AGENTS.md"), "agents\n");
    symlinkSync("AGENTS.md", join(baseWorkspace, "gemini-ready", "GEMINI.md"));
    writeFileSync(join(baseWorkspace, "gemini-ready", "IDENTITY.md"), "identity\n");

    const summary = await getRuntimeOperatorSummary({
      configPath,
      runtimeRunning: false,
    });
    const text = renderStatusSummary(summary);
    const startText = renderStartSummary(summary);

    expect(text).toContain("codex-missing tool=codex bootstrap=personal-assistant:missing");
    expect(text).toContain("claude-pending tool=claude bootstrap=team-assistant:not-bootstrapped");
    expect(text).toContain("codex-ready tool=codex bootstrap=personal-assistant:bootstrapped");
    expect(text).toContain("gemini-ready tool=gemini bootstrap=team-assistant:bootstrapped");
    expect(text).toContain("pendingBootstrap=2");
    expect(text).toContain("bootstrapped=2");
    expect(startText).toContain("Agent claude-pending still needs bootstrap completion.");
    expect(startText).toContain("next: chat with the bot or open the workspace");
    expect(startText).toContain(
      "follow: BOOTSTRAP.md, AGENTS.md, and the rest of the seeded workspace files",
    );
    expect(startText).toContain("Next steps after bootstrap:");
    expect(startText).toContain(
      "run `clisbot bots add --channel <channel-name> ...` for the first provider bot you want to expose",
    );
    expect(startText).toContain("tmux -S ~/.clisbot/state/clisbot.sock list-sessions");
    expect(startText).toContain("tmux -S ~/.clisbot/state/clisbot.sock attach -t <session-name>");
  });

  test("falls back to raw config when token env vars are missing in the operator shell", async () => {
    delete process.env.CLISBOT_HOME;
    delete process.env.SLACK_APP_TOKEN;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;

    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-summary-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = clisbotConfigSchema.parse(
      JSON.parse(
        renderDefaultConfigTemplate({
          channels: {
            slack: { enabled: true },
            telegram: { enabled: true },
          },
        }),
      ),
    );
    config.agents.list = [
      {
        id: "default",
        cli: "codex",
        bootstrap: { botType: "team-assistant" },
      },
    ];
    await writeEditableConfig(configPath, config);

    const summary = await getRuntimeOperatorSummary({
      configPath,
      runtimeRunning: true,
    });
    const text = renderStatusSummary(summary);

    expect(text).toContain("agents=1");
    expect(text).toContain("slack enabled=yes");
    expect(text).toContain("telegram enabled=yes");
  });

  test("renders persisted channel diagnostics when Slack startup fails", async () => {
    delete process.env.CLISBOT_HOME;
    process.env.SLACK_APP_TOKEN = "app";
    process.env.SLACK_BOT_TOKEN = "bot";
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-summary-"));
    const configPath = join(tempDir, "clisbot.json");
    const healthPath = join(tempDir, "runtime-health.json");
    const config = clisbotConfigSchema.parse(
      JSON.parse(
        renderDefaultConfigTemplate({
          channels: {
            slack: { enabled: true },
            telegram: { enabled: false },
          },
        }),
      ),
    );
    config.agents.list = [
      {
        id: "default",
        cli: "codex",
        bootstrap: { botType: "team-assistant" },
      },
    ];
    await writeEditableConfig(configPath, config);

    const healthStore = new RuntimeHealthStore(healthPath);
    await healthStore.markFailure({
      channel: "slack",
      error: new Error("Socket Mode app token rejected: xapp token missing `connections:write`"),
      diagnostic: describeSlackStartupFailure(
        new Error("Socket Mode app token rejected: xapp token missing `connections:write`"),
      ),
    });

    const summary = await getRuntimeOperatorSummary({
      configPath,
      runtimeRunning: false,
      healthPath,
    });
    const text = renderStatusSummary(summary);

    expect(text).toContain("slack enabled=yes connection=failed");
    expect(text).toContain("Channel health:");
    expect(text).toContain("Socket Mode app token was rejected.");
    expect(text).toContain("action: verify `bots.slack.<botId>.appToken` resolves to an `xapp-` token");
  });

  test("renders active runtime channel identities from health metadata", async () => {
    process.env.SLACK_APP_TOKEN = "app";
    process.env.SLACK_BOT_TOKEN = "bot";
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-summary-"));
    const configPath = join(tempDir, "clisbot.json");
    const healthPath = join(tempDir, "runtime-health.json");
    const config = clisbotConfigSchema.parse(
      JSON.parse(
        renderDefaultConfigTemplate({
          channels: {
            slack: { enabled: true },
            telegram: { enabled: false },
          },
        }),
      ),
    );
    config.agents.list = [
      {
        id: "default",
        cli: "codex",
        bootstrap: { botType: "team-assistant" },
      },
    ];
    await writeEditableConfig(configPath, config);

    const healthStore = new RuntimeHealthStore(healthPath);
    await healthStore.setChannel({
      channel: "slack",
      connection: "active",
      summary: "Slack Socket Mode connected for 1 bot(s).",
      instances: [
        {
          botId: "default",
          label: "bot=@longluong2bot",
          appLabel: "app=A123",
          tokenHint: "deadbeef",
        },
      ],
    });

    const summary = await getRuntimeOperatorSummary({
      configPath,
      runtimeRunning: true,
      healthPath,
    });
    const text = renderStatusSummary(summary);

    expect(text).toContain("Channel health:");
    expect(text).toContain("Slack Socket Mode connected for 1 bot(s).");
    expect(text).toContain("instances: bot=default bot=@longluong2bot app=A123 token#deadbeef");
  });
});
