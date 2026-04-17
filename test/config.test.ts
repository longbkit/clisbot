import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/load-config.ts";
import { readEditableConfig, writeEditableConfig } from "../src/config/config-file.ts";

describe("loadConfig", () => {
  let tempDir = "";
  const originalClisbotHome = process.env.CLISBOT_HOME;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    process.env.CLISBOT_HOME = originalClisbotHome;
  });

  test("loads config and expands env vars", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    const configPath = join(tempDir, "clisbot.json");
    await Bun.write(
      configPath,
      JSON.stringify({
        tmux: {
          socketPath: "~/.clisbot/state/test.sock",
        },
        session: {
          mainKey: "main",
          dmScope: "main",
          identityLinks: {
            alice: ["slack:U123"],
          },
          storePath: "~/state/sessions.json",
        },
        agents: {
          defaults: {
            workspace: "~/.clisbot/workspaces/{agentId}",
            runner: {
              command: "codex",
              args: ["-C", "{workspace}"],
              trustWorkspace: true,
              startupDelayMs: 1,
              startupRetryCount: 3,
              startupRetryDelayMs: 250,
              startupReadyPattern: "ready",
              startupBlockers: [
                {
                  pattern: "blocked",
                  message: "blocked message",
                },
              ],
              promptSubmitDelayMs: 1,
              sessionId: {
                create: {
                  mode: "runner",
                  args: [],
                },
                capture: {
                  mode: "status-command",
                  statusCommand: "/status",
                  pattern:
                    "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b",
                  timeoutMs: 1000,
                  pollIntervalMs: 100,
                },
                resume: {
                  mode: "command",
                  args: ["resume", "{sessionId}", "-C", "{workspace}"],
                },
              },
            },
            stream: {
              captureLines: 10,
              updateIntervalMs: 10,
              idleTimeoutMs: 10,
              noOutputTimeoutMs: 10,
              maxRuntimeSec: 10,
              maxMessageChars: 100,
            },
            session: {
              createIfMissing: true,
              staleAfterMinutes: 90,
              name: "{sessionKey}",
            },
          },
          list: [{ id: "default" }],
        },
        control: {
          configReload: {
            watch: true,
            watchDebounceMs: 500,
          },
          sessionCleanup: {
            enabled: true,
            intervalMinutes: 7,
          },
        },
        channels: {
          slack: {
            enabled: true,
            mode: "socket",
            appToken: "${SLACK_APP_TOKEN}",
            botToken: "${SLACK_BOT_TOKEN}",
            ackReaction: ":eyes:",
            typingReaction: ":hourglass_flowing_sand:",
            processingStatus: {
              enabled: true,
              status: "Summarizing findings...",
              loadingMessages: [
                "Reviewing context...",
                "Preparing response...",
              ],
            },
            agentPrompt: {
              enabled: true,
              maxProgressMessages: 3,
              requireFinalResponse: true,
            },
            replyToMode: "thread",
            channelPolicy: "allowlist",
            groupPolicy: "allowlist",
            defaultAgentId: "default",
            commandPrefixes: {
              slash: ["::", "\\"],
              bash: ["!"],
            },
            streaming: "all",
            response: "final",
            responseMode: "message-tool",
            additionalMessageMode: "queue",
            verbose: "minimal",
            followUp: {
              mode: "auto",
              participationTtlSec: 13,
            },
            channels: {
              C123: {
                followUp: {
                  mode: "mention-only",
                },
              },
            },
            groups: {},
            directMessages: {
              enabled: true,
              policy: "pairing",
              allowFrom: ["U123"],
              requireMention: false,
              agentId: "default",
            },
          },
        },
      }),
    );

    process.env.SLACK_APP_TOKEN = "app-token";
    process.env.SLACK_BOT_TOKEN = "bot-token";

    const loaded = await loadConfig(configPath);
    expect(loaded.raw.channels.slack.appToken).toBe("app-token");
    expect(loaded.raw.channels.slack.botToken).toBe("bot-token");
    expect(loaded.raw.channels.slack.ackReaction).toBe(":eyes:");
    expect(loaded.raw.channels.slack.typingReaction).toBe(
      ":hourglass_flowing_sand:",
    );
    expect(loaded.raw.channels.slack.processingStatus.enabled).toBe(true);
    expect(loaded.raw.channels.slack.processingStatus.status).toBe(
      "Summarizing findings...",
    );
    expect(loaded.raw.channels.slack.processingStatus.loadingMessages).toEqual([
      "Reviewing context...",
      "Preparing response...",
    ]);
    expect(loaded.raw.control.configReload.watch).toBe(true);
    expect(loaded.raw.control.configReload.watchDebounceMs).toBe(500);
    expect(loaded.raw.control.sessionCleanup.enabled).toBe(true);
    expect(loaded.raw.control.sessionCleanup.intervalMinutes).toBe(7);
    expect(loaded.raw.tmux.socketPath.endsWith("test.sock")).toBe(true);
    expect(loaded.raw.channels.slack.commandPrefixes).toEqual({
      slash: ["::", "\\"],
      bash: ["!"],
    });
    expect(loaded.raw.channels.slack.responseMode).toBe("message-tool");
    expect(loaded.raw.channels.slack.additionalMessageMode).toBe("queue");
    expect(loaded.raw.channels.slack.surfaceNotifications).toBeUndefined();
    expect(loaded.raw.channels.slack.verbose).toBe("minimal");
    expect(loaded.raw.channels.slack.streaming).toBe("all");
    expect(loaded.raw.channels.slack.response).toBe("final");
    expect(loaded.raw.channels.slack.followUp.mode).toBe("auto");
    expect(loaded.raw.channels.slack.followUp.participationTtlSec).toBe(13);
    expect(loaded.raw.channels.slack.channelPolicy).toBe("allowlist");
    expect(loaded.raw.channels.slack.groupPolicy).toBe("allowlist");
    expect(loaded.raw.channels.slack.directMessages.requireMention).toBe(false);
    expect(loaded.raw.channels.slack.directMessages.policy).toBe("pairing");
    expect(loaded.raw.channels.slack.directMessages.allowFrom).toEqual(["U123"]);
    expect(loaded.raw.channels.slack.channels.C123?.requireMention).toBe(false);
    expect(loaded.raw.channels.slack.channels.C123?.followUp?.mode).toBe(
      "mention-only",
    );
    expect(loaded.raw.app.auth.defaultRole).toBe("member");
    expect(loaded.raw.agents.defaults.auth.defaultRole).toBe("member");
    expect(loaded.raw.session.mainKey).toBe("main");
    expect(loaded.raw.session.dmScope).toBe("main");
    expect(loaded.raw.session.identityLinks.alice).toEqual(["slack:U123"]);
    expect(loaded.raw.session.storePath.endsWith("state/sessions.json")).toBe(
      true,
    );
    expect(loaded.raw.agents.defaults.runner.sessionId.capture.mode).toBe(
      "status-command",
    );
    expect(loaded.raw.agents.defaults.runner.startupReadyPattern).toBe("ready");
    expect(loaded.raw.agents.defaults.runner.startupRetryCount).toBe(3);
    expect(loaded.raw.agents.defaults.runner.startupRetryDelayMs).toBe(250);
    expect(loaded.raw.agents.defaults.runner.startupBlockers).toEqual([
      {
        pattern: "blocked",
        message: "blocked message",
      },
    ]);
    expect(loaded.raw.agents.defaults.runner.sessionId.resume.mode).toBe(
      "command",
    );
    expect(loaded.raw.agents.defaults.session.staleAfterMinutes).toBe(90);
    expect(loaded.raw.bindings).toEqual([]);
  });

  test("applies codex session-id defaults when runner config omits sessionId", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    const configPath = join(tempDir, "clisbot.json");
    await Bun.write(
      configPath,
      JSON.stringify({
        tmux: {
          socketPath: "~/.clisbot/state/test.sock",
        },
        agents: {
          defaults: {
            workspace: "~/.clisbot/workspaces/{agentId}",
            runner: {
              command: "codex",
              args: ["-C", "{workspace}"],
              trustWorkspace: true,
              startupDelayMs: 1,
              promptSubmitDelayMs: 1,
            },
            stream: {
              captureLines: 10,
              updateIntervalMs: 10,
              idleTimeoutMs: 10,
              noOutputTimeoutMs: 10,
              maxRuntimeSec: 10,
              maxMessageChars: 100,
            },
            session: {
              createIfMissing: true,
              name: "{sessionKey}",
            },
          },
          list: [{ id: "default" }],
        },
        channels: {
          slack: {
            enabled: true,
            mode: "socket",
            appToken: "${SLACK_APP_TOKEN}",
            botToken: "${SLACK_BOT_TOKEN}",
            channels: {},
            groups: {},
            directMessages: {
              enabled: true,
              requireMention: false,
              agentId: "default",
            },
          },
        },
      }),
    );

    process.env.SLACK_APP_TOKEN = "app-token";
    process.env.SLACK_BOT_TOKEN = "bot-token";

    const loaded = await loadConfig(configPath);
    expect(loaded.raw.agents.defaults.runner.sessionId.capture.mode).toBe(
      "status-command",
    );
    expect(loaded.raw.agents.defaults.runner.sessionId.resume.mode).toBe(
      "command",
    );
    expect(loaded.raw.channels.slack.followUp.mode).toBe("auto");
    expect(loaded.raw.channels.slack.followUp.participationTtlMin).toBe(5);
    expect(loaded.raw.channels.slack.directMessages.policy).toBe("pairing");
    expect(loaded.raw.channels.slack.directMessages.allowFrom).toEqual([]);
    expect(loaded.raw.app.auth.roles.owner.allow).toContain("configManage");
    expect(loaded.raw.agents.defaults.auth.roles.admin.allow).toContain("shellExecute");
    expect(loaded.raw.channels.slack.ackReaction).toBe("");
    expect(loaded.raw.channels.slack.typingReaction).toBe("");
    expect(loaded.raw.channels.slack.processingStatus.enabled).toBe(true);
    expect(loaded.raw.channels.slack.processingStatus.status).toBe(
      "Working...",
    );
    expect(loaded.raw.channels.slack.processingStatus.loadingMessages).toEqual(
      [],
    );
    expect(loaded.raw.control.configReload.watch).toBe(false);
    expect(loaded.raw.control.configReload.watchDebounceMs).toBe(250);
    expect(loaded.raw.control.sessionCleanup.enabled).toBe(true);
    expect(loaded.raw.control.sessionCleanup.intervalMinutes).toBe(5);
    expect(loaded.raw.agents.defaults.session.staleAfterMinutes).toBe(60);
  });

  test("rejects legacy privilegeCommands config keys", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    const configPath = join(tempDir, "clisbot.json");
    await Bun.write(
      configPath,
      JSON.stringify({
        channels: {
          slack: {
            enabled: true,
            mode: "socket",
            appToken: "${SLACK_APP_TOKEN}",
            botToken: "${SLACK_BOT_TOKEN}",
            privilegeCommands: {
              enabled: true,
              allowUsers: ["U123"],
            },
            channels: {},
            groups: {},
            directMessages: {
              enabled: true,
              requireMention: false,
              agentId: "default",
            },
          },
        },
      }),
    );

    process.env.SLACK_APP_TOKEN = "app-token";
    process.env.SLACK_BOT_TOKEN = "bot-token";

    await expect(loadConfig(configPath)).rejects.toThrow(
      "Unsupported config key at root.channels.slack.privilegeCommands. Move routed permissions to app.auth and agents.<id>.auth.",
    );
  });

  test("does not require token env vars for disabled channels", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    const configPath = join(tempDir, "clisbot.json");
    await Bun.write(
      configPath,
      JSON.stringify({
        tmux: {
          socketPath: "~/.clisbot/state/test.sock",
        },
        agents: {
          defaults: {
            workspace: "~/.clisbot/workspaces/{agentId}",
            runner: {
              command: "codex",
              args: ["-C", "{workspace}"],
              trustWorkspace: true,
              startupDelayMs: 1,
              promptSubmitDelayMs: 1,
            },
            stream: {
              captureLines: 10,
              updateIntervalMs: 10,
              idleTimeoutMs: 10,
              noOutputTimeoutMs: 10,
              maxRuntimeSec: 10,
              maxMessageChars: 100,
            },
            session: {
              createIfMissing: true,
              name: "{sessionKey}",
            },
          },
          list: [{ id: "default" }],
        },
        channels: {
          slack: {
            enabled: true,
            mode: "socket",
            appToken: "${SLACK_APP_TOKEN}",
            botToken: "${SLACK_BOT_TOKEN}",
            channels: {},
            groups: {},
            directMessages: {
              enabled: true,
              requireMention: false,
              agentId: "default",
            },
          },
          telegram: {
            enabled: false,
            mode: "polling",
            botToken: "${TELEGRAM_BOT_TOKEN}",
            groups: {},
            directMessages: {
              enabled: true,
              requireMention: false,
              agentId: "default",
            },
          },
        },
      }),
    );

    process.env.SLACK_APP_TOKEN = "app-token";
    process.env.SLACK_BOT_TOKEN = "bot-token";
    delete process.env.TELEGRAM_BOT_TOKEN;

    const loaded = await loadConfig(configPath);

    expect(loaded.raw.channels.slack.appToken).toBe("app-token");
    expect(loaded.raw.channels.slack.botToken).toBe("bot-token");
    expect(loaded.raw.channels.telegram.enabled).toBe(false);
    expect(loaded.raw.channels.telegram.botToken).toBe("${TELEGRAM_BOT_TOKEN}");
  });

  test("uses CLISBOT_HOME for dynamic default paths", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    const configPath = join(tempDir, "clisbot.json");
    const clisbotHome = join(tempDir, "dev-home");

    process.env.CLISBOT_HOME = clisbotHome;

    await Bun.write(
      configPath,
      JSON.stringify({
        channels: {
          slack: { enabled: false },
          telegram: { enabled: false },
        },
      }),
    );

    const loaded = await loadConfig(configPath);
    expect(loaded.raw.tmux.socketPath).toBe(join(clisbotHome, "state", "clisbot.sock"));
    expect(loaded.raw.session.storePath).toBe(join(clisbotHome, "state", "sessions.json"));
    expect(loaded.raw.agents.defaults.workspace).toBe(join(clisbotHome, "workspaces", "{agentId}"));
    expect(loaded.processedEventsPath).toBe(join(clisbotHome, "state", "processed-slack-events.json"));
    expect(loaded.stateDir).toBe(join(clisbotHome, "state"));
  });

  test("uses CLISBOT_HOME for editable config defaults too", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    const configPath = join(tempDir, "clisbot.json");
    const clisbotHome = join(tempDir, "editable-home");

    process.env.CLISBOT_HOME = clisbotHome;

    await Bun.write(
      configPath,
      JSON.stringify({
        channels: {
          slack: { enabled: false },
          telegram: { enabled: false },
        },
      }),
    );

    const editable = await readEditableConfig(configPath);
    expect(editable.config.tmux.socketPath).toBe(join(clisbotHome, "state", "clisbot.sock"));
    expect(editable.config.session.storePath).toBe(join(clisbotHome, "state", "sessions.json"));
    expect(editable.config.agents.defaults.workspace).toBe(
      join(clisbotHome, "workspaces", "{agentId}"),
    );
    expect(editable.config.session.dmScope).toBe("per-channel-peer");
  });

  test("readEditableConfig rejects legacy privilegeCommands keys too", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-config-"));
    const configPath = join(tempDir, "clisbot.json");

    await Bun.write(
      configPath,
      JSON.stringify({
        channels: {
          slack: {
            enabled: false,
            privilegeCommands: {
              enabled: true,
              allowUsers: ["U123"],
            },
          },
          telegram: {
            enabled: false,
          },
        },
      }),
    );

    await expect(readEditableConfig(configPath)).rejects.toThrow(
      "Unsupported config key at root.channels.slack.privilegeCommands. Move routed permissions to app.auth and agents.<id>.auth.",
    );
  });
});
