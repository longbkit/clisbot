import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityStore } from "../src/control/activity-store.ts";
import { RuntimeHealthStore } from "../src/control/runtime-health-store.ts";
import { getRuntimeOperatorSummary, renderStartSummary, renderStatusSummary } from "../src/control/runtime-summary.ts";
import { writeEditableConfig } from "../src/config/config-file.ts";
import { clisbotConfigSchema } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";

describe("runtime summaries", () => {
  let tempDir = "";
  const originalClisbotHome = process.env.CLISBOT_HOME;
  const originalSlackAppToken = process.env.SLACK_APP_TOKEN;
  const originalSlackBotToken = process.env.SLACK_BOT_TOKEN;
  const originalTelegramBotToken = process.env.TELEGRAM_BOT_TOKEN;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    process.env.CLISBOT_HOME = originalClisbotHome;
    process.env.SLACK_APP_TOKEN = originalSlackAppToken;
    process.env.SLACK_BOT_TOKEN = originalSlackBotToken;
    process.env.TELEGRAM_BOT_TOKEN = originalTelegramBotToken;
  });

  test("renders first-run guidance when no agents exist", async () => {
    process.env.SLACK_APP_TOKEN = "app";
    process.env.SLACK_BOT_TOKEN = "bot";
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-summary-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = clisbotConfigSchema.parse(
      JSON.parse(
        renderDefaultConfigTemplate({
          slackEnabled: true,
          telegramEnabled: true,
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
          slackEnabled: false,
          telegramEnabled: true,
        }),
      ),
    );
    config.agents.list = [
      {
        id: "default",
        cliTool: "codex",
      },
    ];
    await writeEditableConfig(configPath, config);

    const summary = await getRuntimeOperatorSummary({
      configPath,
      runtimeRunning: false,
    });
    const text = renderStartSummary(summary);

    expect(text).toContain("clisbot channels enable <slack|telegram>");
    expect(text).toContain("clisbot channels add telegram-group <chatId> --agent <id>");
    expect(text).toContain("tmux -S ~/.clisbot-dev/state/clisbot.sock list-sessions");
    expect(text).toContain("tmux -S ~/.clisbot-dev/state/clisbot.sock attach -t <session-name>");
  });

  test("renders agent and channel activity in status output", async () => {
    process.env.SLACK_APP_TOKEN = "app";
    process.env.SLACK_BOT_TOKEN = "bot";
    process.env.TELEGRAM_BOT_TOKEN = "telegram";
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-summary-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = clisbotConfigSchema.parse(
      JSON.parse(
        renderDefaultConfigTemplate({
          slackEnabled: true,
          telegramEnabled: true,
        }),
      ),
    );
    config.agents.list = [
      {
        id: "work",
        cliTool: "codex",
        startupOptions: ["--dangerously-bypass-approvals-and-sandbox", "--no-alt-screen"],
        workspace: join(tempDir, "workspaces", "work"),
        bootstrap: {
          mode: "team-assistant",
        },
      },
    ];
    config.bindings = [
      {
        match: {
          channel: "slack",
        },
        agentId: "work",
      },
    ];
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
    expect(text).toContain("routes=none");
    expect(text).toContain("telegram: no explicit group or topic routes are configured yet");
    expect(startText).toContain("telegram: no explicit group or topic routes are configured yet");
    expect(startText).toContain("DM the Telegram or Slack bot first to confirm it responds normally");
    expect(startText).toContain("after DM works, add the bot to the target Slack channel or Telegram group/topic");
    expect(startText).toContain(
      "route that surface with `clisbot channels add slack-channel <channelId> --agent <id>` or `clisbot channels add telegram-group <chatId> --agent <id>`",
    );
    expect(startText).toContain(
      "Telegram: send `/start` in the target DM, group, or topic to get onboarding or pairing guidance",
    );
    expect(startText).toContain(
      "Slack: mention `@<botname> \\start` in the target channel to verify mention flow",
    );
    expect(startText).toContain(
      "Send a direct message (DM) to the Telegram or Slack bot. Send `/start` or `hi` to receive a pairing code.",
    );
    expect(startText).toContain("Auth onboarding:");
    expect(startText).toContain("Telegram groups or topics can use `/whoami` before routing, while DMs with pairing must pair first");
    expect(startText).toContain("clisbot auth add-user app --role owner --user <principal>");
    expect(startText).toContain("clisbot auth add-permission ...");
    expect(startText).toContain("clisbot auth --help");
    expect(startText).toContain("clisbot pairing approve telegram <code>");
    expect(startText).toContain("clisbot pairing approve slack <code>");
    expect(startText).toContain("Configured app owner/admin principals bypass pairing in DMs.");
    expect(startText).toContain("tmux -S ~/.clisbot/state/clisbot.sock list-sessions");
    expect(startText).toContain("tmux -S ~/.clisbot/state/clisbot.sock attach -t <session-name>");
  });

  test("renders active runs in operator status output", async () => {
    process.env.SLACK_APP_TOKEN = "app";
    process.env.SLACK_BOT_TOKEN = "bot";
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-summary-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate({
      slackEnabled: true,
      telegramEnabled: false,
    })));
    config.agents.list = [
      {
        id: "work",
        cliTool: "codex",
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
    config.session.storePath = join(tempDir, "sessions.json");
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
    expect(text).toContain("agent=work");
    expect(text).toContain("state=detached");
    expect(text).toContain("sessionKey=agent:work:slack:channel:C123:thread:1.2");
  });

  test("distinguishes missing, not-bootstrapped, and bootstrapped bootstrap states", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-summary-"));
    const configPath = join(tempDir, "clisbot.json");
    const baseWorkspace = join(tempDir, "workspaces");
    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    config.agents.list = [
      {
        id: "codex-missing",
        cliTool: "codex",
        workspace: join(baseWorkspace, "codex-missing"),
        bootstrap: { mode: "personal-assistant" },
      },
      {
        id: "claude-pending",
        cliTool: "claude",
        workspace: join(baseWorkspace, "claude-pending"),
        bootstrap: { mode: "team-assistant" },
      },
      {
        id: "codex-ready",
        cliTool: "codex",
        workspace: join(baseWorkspace, "codex-ready"),
        bootstrap: { mode: "personal-assistant" },
      },
      {
        id: "gemini-ready",
        cliTool: "gemini",
        workspace: join(baseWorkspace, "gemini-ready"),
        bootstrap: { mode: "team-assistant" },
      },
    ];
    await writeEditableConfig(configPath, config);

    mkdirSync(join(baseWorkspace, "claude-pending"), { recursive: true });
    writeFileSync(join(baseWorkspace, "claude-pending", "CLAUDE.md"), "claude\n");
    writeFileSync(join(baseWorkspace, "claude-pending", "IDENTITY.md"), "identity\n");
    writeFileSync(join(baseWorkspace, "claude-pending", "BOOTSTRAP.md"), "bootstrap\n");

    mkdirSync(join(baseWorkspace, "codex-ready"), { recursive: true });
    writeFileSync(join(baseWorkspace, "codex-ready", "AGENTS.md"), "agents\n");
    writeFileSync(join(baseWorkspace, "codex-ready", "IDENTITY.md"), "identity\n");
    writeFileSync(join(baseWorkspace, "codex-ready", "BOOTSTRAP.md"), "bootstrap\n");
    unlinkSync(join(baseWorkspace, "codex-ready", "BOOTSTRAP.md"));

    mkdirSync(join(baseWorkspace, "gemini-ready"), { recursive: true });
    writeFileSync(join(baseWorkspace, "gemini-ready", "GEMINI.md"), "gemini\n");
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
    expect(startText).toContain("follow: BOOTSTRAP.md and the team-assistant personality files");
    expect(startText).toContain("Next steps after bootstrap:");
    expect(startText).toContain(
      "run `clisbot channels enable <slack|telegram>` for the first channel you want to expose",
    );
    expect(startText).toContain("tmux -S ~/.clisbot/state/clisbot.sock list-sessions");
    expect(startText).toContain("tmux -S ~/.clisbot/state/clisbot.sock attach -t <session-name>");
  });

  test("falls back to raw config when token env vars are missing in the operator shell", async () => {
    delete process.env.SLACK_APP_TOKEN;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;

    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-summary-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = clisbotConfigSchema.parse(
      JSON.parse(
        renderDefaultConfigTemplate({
          slackEnabled: true,
          telegramEnabled: true,
        }),
      ),
    );
    config.agents.list = [
      {
        id: "default",
        cliTool: "codex",
        bootstrap: { mode: "team-assistant" },
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
    process.env.SLACK_APP_TOKEN = "app";
    process.env.SLACK_BOT_TOKEN = "bot";
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-summary-"));
    const configPath = join(tempDir, "clisbot.json");
    const healthPath = join(tempDir, "runtime-health.json");
    const config = clisbotConfigSchema.parse(
      JSON.parse(
        renderDefaultConfigTemplate({
          slackEnabled: true,
          telegramEnabled: false,
        }),
      ),
    );
    config.agents.list = [
      {
        id: "default",
        cliTool: "codex",
        bootstrap: { mode: "team-assistant" },
      },
    ];
    await writeEditableConfig(configPath, config);

    const healthStore = new RuntimeHealthStore(healthPath);
    await healthStore.markSlackFailure(new Error("Socket Mode app token rejected: xapp token missing `connections:write`"));

    const summary = await getRuntimeOperatorSummary({
      configPath,
      runtimeRunning: false,
      healthPath,
    });
    const text = renderStatusSummary(summary);

    expect(text).toContain("slack enabled=yes connection=failed");
    expect(text).toContain("Channel health:");
    expect(text).toContain("Socket Mode app token was rejected.");
    expect(text).toContain("action: verify `channels.slack.appToken` resolves to an `xapp-` token");
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
          slackEnabled: true,
          telegramEnabled: false,
        }),
      ),
    );
    config.agents.list = [
      {
        id: "default",
        cliTool: "codex",
        bootstrap: { mode: "team-assistant" },
      },
    ];
    await writeEditableConfig(configPath, config);

    const healthStore = new RuntimeHealthStore(healthPath);
    await healthStore.setChannel({
      channel: "slack",
      connection: "active",
      summary: "Slack Socket Mode connected for 1 account(s).",
      instances: [
        {
          accountId: "default",
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
    expect(text).toContain("Slack Socket Mode connected for 1 account(s).");
    expect(text).toContain("instances: default bot=@longluong2bot app=A123 token#deadbeef");
  });
});
