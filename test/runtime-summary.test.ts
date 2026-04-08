import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityStore } from "../src/control/activity-store.ts";
import { getRuntimeOperatorSummary, renderStartSummary, renderStatusSummary } from "../src/control/runtime-summary.ts";
import { writeEditableConfig } from "../src/config/config-file.ts";
import { muxbotConfigSchema } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";

describe("runtime summaries", () => {
  let tempDir = "";
  const originalSlackAppToken = process.env.SLACK_APP_TOKEN;
  const originalSlackBotToken = process.env.SLACK_BOT_TOKEN;
  const originalTelegramBotToken = process.env.TELEGRAM_BOT_TOKEN;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    process.env.SLACK_APP_TOKEN = originalSlackAppToken;
    process.env.SLACK_BOT_TOKEN = originalSlackBotToken;
    process.env.TELEGRAM_BOT_TOKEN = originalTelegramBotToken;
  });

  test("renders first-run guidance when no agents exist", async () => {
    process.env.SLACK_APP_TOKEN = "app";
    process.env.SLACK_BOT_TOKEN = "bot";
    tempDir = mkdtempSync(join(tmpdir(), "muxbot-runtime-summary-"));
    const configPath = join(tempDir, "muxbot.json");
    const config = muxbotConfigSchema.parse(
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
    expect(text).toContain("First run requires both `--cli` and `--bootstrap`.");
    expect(text).toContain("personal-assistant = one assistant for one human.");
    expect(text).toContain("team-assistant = one shared assistant for a team or channel.");
    expect(text).toContain("muxbot start --cli codex --bootstrap personal-assistant");
    expect(text).toContain("Help: muxbot --help");
  });

  test("renders agent and channel activity in status output", async () => {
    process.env.SLACK_APP_TOKEN = "app";
    process.env.SLACK_BOT_TOKEN = "bot";
    process.env.TELEGRAM_BOT_TOKEN = "telegram";
    tempDir = mkdtempSync(join(tmpdir(), "muxbot-runtime-summary-"));
    const configPath = join(tempDir, "muxbot.json");
    const config = muxbotConfigSchema.parse(
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
    expect(text).toContain("work tool=codex");
    expect(text).toContain("slack enabled=yes");
    expect(text).toContain("dm=pairing");
    expect(text).toContain("routes=none");
    expect(text).toContain("telegram: no explicit group or topic routes are configured yet");
    expect(startText).toContain("telegram: no explicit group or topic routes are configured yet");
  });

  test("distinguishes missing, not-bootstrapped, and bootstrapped bootstrap states", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "muxbot-runtime-summary-"));
    const configPath = join(tempDir, "muxbot.json");
    const baseWorkspace = join(tempDir, "workspaces");
    const config = muxbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
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

    const summary = await getRuntimeOperatorSummary({
      configPath,
      runtimeRunning: false,
    });
    const text = renderStatusSummary(summary);
    const startText = renderStartSummary(summary);

    expect(text).toContain("codex-missing tool=codex bootstrap=personal-assistant:missing");
    expect(text).toContain("claude-pending tool=claude bootstrap=team-assistant:not-bootstrapped");
    expect(text).toContain("codex-ready tool=codex bootstrap=personal-assistant:bootstrapped");
    expect(text).toContain("pendingBootstrap=2");
    expect(text).toContain("bootstrapped=1");
    expect(startText).toContain("Chat with the bot or open the workspace, then follow BOOTSTRAP.md");
    expect(startText).toContain("Next steps after bootstrap:");
  });
});
