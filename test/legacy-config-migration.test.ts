import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigWithoutEnvResolution } from "../src/config/load-config.ts";

describe("legacy config migration", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("migrates legacy channels config into bot-owned config", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = {
      meta: {
        schemaVersion: 1,
      },
      tmux: {
        socketPath: "~/.clisbot-dev/state/clisbot.sock",
      },
      session: {
        mainKey: "main",
        identityLinks: {},
        storePath: "~/.clisbot-dev/state/sessions.json",
      },
      control: {
        configReload: {
          watch: true,
          watchDebounceMs: 250,
        },
        sessionCleanup: {
          enabled: true,
          intervalMinutes: 7,
        },
        loop: {
          maxRunsPerLoop: 20,
          maxActiveLoops: 10,
        },
      },
      agents: {
        defaults: {
          workspace: "~/.clisbot-dev/workspaces/{agentId}",
          runner: {
            command: "codex",
            args: ["--dangerously-bypass-approvals-and-sandbox", "--no-alt-screen", "-C", "{workspace}"],
            trustWorkspace: true,
            promptSubmitDelayMs: 150,
            sessionId: {
              capture: {
                mode: "status-command",
                statusCommand: "/status",
              },
            },
          },
          stream: {
            maxRuntimeMin: 15,
          },
          session: {
            staleAfterMinutes: 45,
          },
        },
        list: [
          {
            id: "default",
            cliTool: "codex",
            bootstrap: {
              mode: "team-assistant",
            },
          },
        ],
      },
      channels: {
        slack: {
          enabled: true,
          mode: "socket",
          appToken: "${SLACK_APP_TOKEN}",
          botToken: "${SLACK_BOT_TOKEN}",
          defaultAccount: "default",
          accounts: {
            default: {
              appToken: "${SLACK_APP_TOKEN}",
              botToken: "${SLACK_BOT_TOKEN}",
            },
          },
          defaultAgentId: "default",
          channelPolicy: "allowlist",
          groupPolicy: "allowlist",
          streaming: "all",
          responseMode: "message-tool",
          additionalMessageMode: "steer",
          directMessages: {
            enabled: true,
            policy: "pairing",
            allowFrom: ["U_OWNER"],
            requireMention: false,
          },
          channels: {
            C07U0LDK6ER: {
              requireMention: true,
              allowBots: false,
              agentId: "default",
              streaming: "off",
            },
          },
        },
        telegram: {
          enabled: false,
          botToken: "${TELEGRAM_BOT_TOKEN}",
          defaultAccount: "default",
          accounts: {
            default: {
              botToken: "${TELEGRAM_BOT_TOKEN}",
            },
          },
          directMessages: {
            enabled: true,
            policy: "pairing",
            allowFrom: ["1276408333"],
            requireMention: false,
          },
        },
      },
    };

    await Bun.write(configPath, JSON.stringify(config));
    const loaded = await loadConfigWithoutEnvResolution(configPath);
    const slackBot = loaded.raw.bots.slack.default;

    expect(loaded.raw.meta.schemaVersion).toBe("0.1.45");
    expect(loaded.raw.bots.slack.defaults.enabled).toBe(true);
    expect(loaded.raw.bots.slack.defaults.defaultBotId).toBe("default");
    expect(slackBot.enabled).toBe(true);
    expect(slackBot.appToken).toBe("${SLACK_APP_TOKEN}");
    expect(slackBot.botToken).toBe("${SLACK_BOT_TOKEN}");
    expect(slackBot.agentId).toBe("default");
    expect(slackBot.directMessages["*"]?.policy).toBe("pairing");
    expect(slackBot.directMessages["*"]?.allowUsers).toEqual(["U_OWNER"]);
    expect(slackBot.groups.C07U0LDK6ER?.streaming).toBe("off");
    expect(loaded.raw.bots.telegram.default.botToken).toBe("${TELEGRAM_BOT_TOKEN}");
    expect(loaded.raw.bots.telegram.default.directMessages["*"]?.allowUsers).toEqual([
      "1276408333",
    ]);
    expect(loaded.raw.session.storePath).toContain(".clisbot-dev/state/sessions.json");
    expect(loaded.raw.tmux.socketPath).toContain(".clisbot-dev/state/clisbot.sock");
    expect(loaded.raw.control.sessionCleanup.intervalMinutes).toBe(7);
    expect(loaded.raw.agents.defaults.runner.defaults.stream.maxRuntimeMin).toBe(15);
    expect(loaded.raw.agents.defaults.runner.defaults.session.staleAfterMinutes).toBe(45);
    expect(loaded.raw.agents.defaults.runner.codex.args).toEqual([
      "--dangerously-bypass-approvals-and-sandbox",
      "--no-alt-screen",
      "-C",
      "{workspace}",
    ]);
    expect(loaded.raw.agents.list[0]?.cli).toBe("codex");
    expect(loaded.raw.agents.list[0]?.bootstrap?.botType).toBe("team-assistant");
  });
});
