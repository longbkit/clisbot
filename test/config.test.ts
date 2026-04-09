import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/load-config.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";

describe("loadConfig", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("loads config and expands env vars", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "muxbot-config-"));
    const configPath = join(tempDir, "muxbot.json");
    await Bun.write(
      configPath,
      JSON.stringify({
        tmux: {
          socketPath: "~/.muxbot/state/test.sock",
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
            workspace: "~/.muxbot/workspaces/{agentId}",
            runner: {
              command: "codex",
              args: ["-C", "{workspace}"],
              trustWorkspace: true,
              startupDelayMs: 1,
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
            replyToMode: "thread",
            channelPolicy: "allowlist",
            groupPolicy: "allowlist",
            defaultAgentId: "default",
            privilegeCommands: {
              enabled: false,
              allowUsers: [],
            },
            commandPrefixes: {
              slash: ["::", "\\"],
              bash: ["!"],
            },
            streaming: "all",
            response: "final",
            followUp: {
              mode: "auto",
              participationTtlSec: 13,
            },
            channels: {
              C123: {
                requireMention: true,
                privilegeCommands: {
                  enabled: true,
                  allowUsers: ["u123"],
                },
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
    expect(loaded.raw.channels.slack.streaming).toBe("all");
    expect(loaded.raw.channels.slack.response).toBe("final");
    expect(loaded.raw.channels.slack.followUp.mode).toBe("auto");
    expect(loaded.raw.channels.slack.followUp.participationTtlSec).toBe(13);
    expect(loaded.raw.channels.slack.channelPolicy).toBe("allowlist");
    expect(loaded.raw.channels.slack.groupPolicy).toBe("allowlist");
    expect(loaded.raw.channels.slack.privilegeCommands.enabled).toBe(false);
    expect(loaded.raw.channels.slack.privilegeCommands.allowUsers).toEqual([]);
    expect(loaded.raw.channels.slack.directMessages.requireMention).toBe(false);
    expect(loaded.raw.channels.slack.directMessages.policy).toBe("pairing");
    expect(loaded.raw.channels.slack.directMessages.allowFrom).toEqual(["U123"]);
    expect(loaded.raw.channels.slack.channels.C123?.privilegeCommands).toEqual({
      enabled: true,
      allowUsers: ["u123"],
    });
    expect(loaded.raw.channels.slack.channels.C123?.followUp?.mode).toBe(
      "mention-only",
    );
    expect(loaded.raw.session.mainKey).toBe("main");
    expect(loaded.raw.session.dmScope).toBe("main");
    expect(loaded.raw.session.identityLinks.alice).toEqual(["slack:U123"]);
    expect(loaded.raw.session.storePath.endsWith("state/sessions.json")).toBe(
      true,
    );
    expect(loaded.raw.agents.defaults.runner.sessionId.capture.mode).toBe(
      "status-command",
    );
    expect(loaded.raw.agents.defaults.runner.sessionId.resume.mode).toBe(
      "command",
    );
    expect(loaded.raw.agents.defaults.session.staleAfterMinutes).toBe(90);
    expect(loaded.raw.bindings).toEqual([]);
  });

  test("applies codex session-id defaults when runner config omits sessionId", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "muxbot-config-"));
    const configPath = join(tempDir, "muxbot.json");
    await Bun.write(
      configPath,
      JSON.stringify({
        tmux: {
          socketPath: "~/.muxbot/state/test.sock",
        },
        agents: {
          defaults: {
            workspace: "~/.muxbot/workspaces/{agentId}",
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
    expect(loaded.raw.channels.slack.privilegeCommands).toEqual({
      enabled: false,
      allowUsers: [],
    });
    expect(loaded.raw.channels.slack.directMessages.policy).toBe("pairing");
    expect(loaded.raw.channels.slack.directMessages.allowFrom).toEqual([]);
    expect(loaded.raw.channels.slack.ackReaction).toBe(":heavy_check_mark:");
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

  test("default config template does not preseed sample slack or telegram routes", () => {
    const config = JSON.parse(renderDefaultConfigTemplate()) as {
      channels: {
        slack: {
          enabled: boolean;
          appToken: string;
          botToken: string;
          channels: Record<string, unknown>;
          groups: Record<string, unknown>;
          directMessages: {
            privilegeCommands: {
              enabled: boolean;
            };
          };
        };
        telegram: {
          enabled: boolean;
          botToken: string;
          groups: Record<string, unknown>;
          directMessages: {
            privilegeCommands: {
              enabled: boolean;
            };
          };
        };
      };
    };

    expect(config.channels.slack.enabled).toBe(false);
    expect(config.channels.telegram.enabled).toBe(false);
    expect(config.channels.slack.appToken).toBe("${SLACK_APP_TOKEN}");
    expect(config.channels.slack.botToken).toBe("${SLACK_BOT_TOKEN}");
    expect(config.channels.telegram.botToken).toBe("${TELEGRAM_BOT_TOKEN}");
    expect(config.channels.slack.channels).toEqual({});
    expect(config.channels.slack.groups).toEqual({});
    expect(config.channels.telegram.groups).toEqual({});
    expect(config.channels.slack.directMessages.privilegeCommands.enabled).toBe(false);
    expect(config.channels.telegram.directMessages.privilegeCommands.enabled).toBe(false);
  });

  test("default config template can enable only the available default channels", () => {
    const config = JSON.parse(
      renderDefaultConfigTemplate({
        slackEnabled: true,
        telegramEnabled: false,
      }),
    ) as {
      channels: {
        slack: { enabled: boolean; appToken: string; botToken: string };
        telegram: { enabled: boolean; botToken: string };
      };
    };

    expect(config.channels.slack.enabled).toBe(true);
    expect(config.channels.telegram.enabled).toBe(false);
    expect(config.channels.slack.appToken).toBe("${SLACK_APP_TOKEN}");
    expect(config.channels.slack.botToken).toBe("${SLACK_BOT_TOKEN}");
    expect(config.channels.telegram.botToken).toBe("${TELEGRAM_BOT_TOKEN}");
  });

  test("default config template preserves custom token env placeholders as literals", () => {
    const config = JSON.parse(
      renderDefaultConfigTemplate({
        slackEnabled: true,
        telegramEnabled: true,
        slackAppTokenRef: "${CUSTOM_SLACK_APP_TOKEN}",
        slackBotTokenRef: "${CUSTOM_SLACK_BOT_TOKEN}",
        telegramBotTokenRef: "${CUSTOM_TELEGRAM_BOT_TOKEN}",
      }),
    ) as {
      channels: {
        slack: { enabled: boolean; appToken: string; botToken: string };
        telegram: { enabled: boolean; botToken: string };
      };
    };

    expect(config.channels.slack.enabled).toBe(true);
    expect(config.channels.telegram.enabled).toBe(true);
    expect(config.channels.slack.appToken).toBe("${CUSTOM_SLACK_APP_TOKEN}");
    expect(config.channels.slack.botToken).toBe("${CUSTOM_SLACK_BOT_TOKEN}");
    expect(config.channels.telegram.botToken).toBe("${CUSTOM_TELEGRAM_BOT_TOKEN}");
  });

  test("default config template normalizes bare custom env names into placeholders", () => {
    const config = JSON.parse(
      renderDefaultConfigTemplate({
        slackEnabled: true,
        telegramEnabled: true,
        slackAppTokenRef: "CUSTOM_SLACK_APP_TOKEN",
        slackBotTokenRef: "CUSTOM_SLACK_BOT_TOKEN",
        telegramBotTokenRef: "CUSTOM_TELEGRAM_BOT_TOKEN",
      }),
    ) as {
      channels: {
        slack: { enabled: boolean; appToken: string; botToken: string };
        telegram: { enabled: boolean; botToken: string };
      };
    };

    expect(config.channels.slack.appToken).toBe("${CUSTOM_SLACK_APP_TOKEN}");
    expect(config.channels.slack.botToken).toBe("${CUSTOM_SLACK_BOT_TOKEN}");
    expect(config.channels.telegram.botToken).toBe("${CUSTOM_TELEGRAM_BOT_TOKEN}");
  });

  test("does not require token env vars for disabled channels", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "muxbot-config-"));
    const configPath = join(tempDir, "muxbot.json");
    await Bun.write(
      configPath,
      JSON.stringify({
        tmux: {
          socketPath: "~/.muxbot/state/test.sock",
        },
        agents: {
          defaults: {
            workspace: "~/.muxbot/workspaces/{agentId}",
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
});
