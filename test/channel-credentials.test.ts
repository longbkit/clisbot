import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getCanonicalTelegramBotTokenPath,
  getTelegramMemEnvName,
  materializeRuntimeChannelCredentials,
  parseTokenInput,
  setTelegramRuntimeCredential,
  validatePersistentChannelCredentials,
} from "../src/config/channel-credentials.ts";
import {
  applyBootstrapAccountsToConfig,
  deactivateExpiredMemAccounts,
} from "../src/config/channel-account-management.ts";
import type { ClisbotConfig } from "../src/config/schema.ts";

function createConfig(): ClisbotConfig {
  return {
    meta: { schemaVersion: 1 },
    tmux: { socketPath: "~/.clisbot/state/clisbot.sock" },
    session: {
      mainKey: "main",
      dmScope: "main",
      identityLinks: {},
      storePath: "~/.clisbot/state/sessions.json",
    },
    app: {
      auth: {
        ownerClaimWindowMinutes: 30,
        defaultRole: "member",
        roles: {
          owner: { allow: ["configManage"], users: [] },
          admin: { allow: ["configManage"], users: [] },
          member: { allow: [], users: [] },
        },
      },
    },
    agents: {
      defaults: {
        workspace: "~/.clisbot/workspaces/{agentId}",
        auth: {
          defaultRole: "member",
          roles: {
            admin: { allow: ["shellExecute"], users: [] },
            member: { allow: ["sendMessage"], users: [] },
          },
        },
        runner: {
          command: "codex",
          args: ["-C", "{workspace}"],
          trustWorkspace: true,
          startupDelayMs: 1,
          startupRetryCount: 2,
          startupRetryDelayMs: 0,
          promptSubmitDelayMs: 1,
          sessionId: {
            create: { mode: "runner", args: [] },
            capture: {
              mode: "off",
              statusCommand: "/status",
              pattern: "x",
              timeoutMs: 1,
              pollIntervalMs: 1,
            },
            resume: { mode: "off", args: [] },
          },
        },
        stream: {
          captureLines: 1,
          updateIntervalMs: 1,
          idleTimeoutMs: 1,
          noOutputTimeoutMs: 1,
          maxRuntimeMin: 1,
          maxMessageChars: 100,
        },
        session: {
          createIfMissing: true,
          staleAfterMinutes: 60,
          name: "{sessionKey}",
        },
      },
      list: [],
    },
    bindings: [],
    control: {
      configReload: { watch: false, watchDebounceMs: 250 },
      sessionCleanup: { enabled: true, intervalMinutes: 5 },
      loop: { maxRunsPerLoop: 20, maxActiveLoops: 10 },
      runtimeMonitor: {
        restartBackoff: {
          fastRetry: { delaySeconds: 10, maxRestarts: 3 },
          stages: [
            { delayMinutes: 15, maxRestarts: 4 },
            { delayMinutes: 30, maxRestarts: 4 },
          ],
        },
        ownerAlerts: { enabled: true, minIntervalMinutes: 30 },
      },
    },
    channels: {
      slack: {
        enabled: false,
        mode: "socket",
        appToken: "",
        botToken: "",
        defaultAccount: "default",
        accounts: {},
        agentPrompt: {
          enabled: true,
          maxProgressMessages: 3,
          requireFinalResponse: true,
        },
        ackReaction: "",
        typingReaction: "",
        processingStatus: { enabled: true, status: "Working...", loadingMessages: [] },
        allowBots: false,
        replyToMode: "thread",
        channelPolicy: "allowlist",
        groupPolicy: "allowlist",
        defaultAgentId: "default",
        commandPrefixes: { slash: ["::"], bash: ["!"] },
        streaming: "all",
        response: "final",
        responseMode: "message-tool",
        additionalMessageMode: "steer",
        verbose: "minimal",
        followUp: { mode: "auto", participationTtlMin: 5 },
        channels: {},
        groups: {},
        directMessages: { enabled: true, policy: "pairing", allowFrom: [], requireMention: false },
      },
      telegram: {
        enabled: true,
        mode: "polling",
        botToken: "${TELEGRAM_BOT_TOKEN}",
        defaultAccount: "default",
        accounts: {
          default: {
            botToken: "${TELEGRAM_BOT_TOKEN}",
          },
        },
        agentPrompt: {
          enabled: true,
          maxProgressMessages: 3,
          requireFinalResponse: true,
        },
        allowBots: false,
        groupPolicy: "allowlist",
        defaultAgentId: "default",
        commandPrefixes: { slash: ["::"], bash: ["!"] },
        streaming: "all",
        response: "final",
        responseMode: "message-tool",
        additionalMessageMode: "steer",
        verbose: "minimal",
        followUp: { mode: "auto", participationTtlMin: 5 },
        polling: { timeoutSeconds: 20, retryDelayMs: 1000 },
        groups: {},
        directMessages: {
          enabled: true,
          policy: "pairing",
          allowFrom: [],
          requireMention: false,
          allowBots: false,
        },
      },
    },
  };
}

describe("channel credentials", () => {
  let tempDir = "";
  const originalHome = process.env.CLISBOT_HOME;

  afterEach(() => {
    process.env.CLISBOT_HOME = originalHome;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("parses env placeholders and literal token input", () => {
    expect(parseTokenInput("TELEGRAM_BOT_TOKEN")).toEqual({
      kind: "env",
      envName: "TELEGRAM_BOT_TOKEN",
      placeholder: "${TELEGRAM_BOT_TOKEN}",
    });
    expect(parseTokenInput("${TELEGRAM_BOT_TOKEN}")).toEqual({
      kind: "env",
      envName: "TELEGRAM_BOT_TOKEN",
      placeholder: "${TELEGRAM_BOT_TOKEN}",
    });
    expect(parseTokenInput("123456:abc")).toEqual({
      kind: "mem",
      secret: "123456:abc",
    });
  });

  test("materializes credentialType=mem from the runtime credential store", () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-channel-credentials-"));
    process.env.CLISBOT_HOME = tempDir;
    const config = createConfig();
    config.channels.telegram.accounts.default = {
      credentialType: "mem",
      botToken: "",
    };
    config.channels.telegram.botToken = "";
    setTelegramRuntimeCredential({
      accountId: "default",
      botToken: "telegram-mem-token",
    });

    const resolved = materializeRuntimeChannelCredentials(config);
    expect(resolved.channels.telegram.accounts.default.botToken).toBe("telegram-mem-token");
    expect(resolved.channels.telegram.botToken).toBe("telegram-mem-token");
  });

  test("materializes credentialType=mem from runtime env injection", () => {
    const config = createConfig();
    config.channels.telegram.accounts.default = {
      credentialType: "mem",
      botToken: "",
    };
    config.channels.telegram.botToken = "";

    const resolved = materializeRuntimeChannelCredentials(config, {
      env: {
        ...process.env,
        [getTelegramMemEnvName("default")]: "telegram-mem-env-token",
      },
    });

    expect(resolved.channels.telegram.accounts.default.botToken).toBe("telegram-mem-env-token");
    expect(resolved.channels.telegram.botToken).toBe("telegram-mem-env-token");
  });

  test("skips missing mem accounts instead of throwing during materialization", () => {
    const config = createConfig();
    config.channels.telegram.accounts.default = {
      credentialType: "mem",
      botToken: "",
    };
    config.channels.telegram.botToken = "";

    const resolved = materializeRuntimeChannelCredentials(config);
    expect(resolved.channels.telegram.accounts).toEqual({});
    expect(resolved.channels.telegram.botToken).toBe("");
  });

  test("deactivates expired mem accounts and disables the channel when none remain", () => {
    const config = createConfig();
    config.channels.telegram.accounts.default = {
      enabled: true,
      credentialType: "mem",
      botToken: "",
    };
    config.channels.telegram.botToken = "";

    const lines = deactivateExpiredMemAccounts(config);

    expect(lines).toEqual([
      "Disabled expired telegram/default (credentialType=mem).",
    ]);
    expect(config.channels.telegram.accounts.default.enabled).toBe(false);
    expect(config.channels.telegram.enabled).toBe(false);
    expect(config.channels.telegram.botToken).toBe("");
  });

  test("bootstrap account application keeps channel root tokens empty", () => {
    const config = createConfig();

    applyBootstrapAccountsToConfig(
      config,
      {
        slackAccounts: [
          {
            accountId: "default",
            appToken: {
              kind: "env",
              envName: "SLACK_APP_TOKEN",
              placeholder: "${SLACK_APP_TOKEN}",
            },
            botToken: {
              kind: "env",
              envName: "SLACK_BOT_TOKEN",
              placeholder: "${SLACK_BOT_TOKEN}",
            },
          },
        ],
        telegramAccounts: [
          {
            accountId: "default",
            botToken: {
              kind: "env",
              envName: "TELEGRAM_BOT_TOKEN",
              placeholder: "${TELEGRAM_BOT_TOKEN}",
            },
          },
        ],
      },
      { firstRun: true },
    );

    expect(config.channels.slack.appToken).toBe("");
    expect(config.channels.slack.botToken).toBe("");
    expect(config.channels.telegram.botToken).toBe("");
    expect(config.channels.slack.accounts.default?.appToken).toBe("${SLACK_APP_TOKEN}");
    expect(config.channels.slack.accounts.default?.botToken).toBe("${SLACK_BOT_TOKEN}");
    expect(config.channels.telegram.accounts.default?.botToken).toBe("${TELEGRAM_BOT_TOKEN}");
  });

  test("prefers the canonical credential file before env-backed fallback", () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-channel-credentials-"));
    process.env.CLISBOT_HOME = tempDir;
    const config = createConfig();
    const canonicalPath = getCanonicalTelegramBotTokenPath("default");
    mkdirSync(join(tempDir, "credentials", "telegram", "default"), { recursive: true });
    writeFileSync(canonicalPath, "telegram-file-token\n", { encoding: "utf8", mode: 0o600 });

    const resolved = materializeRuntimeChannelCredentials(config, {
      env: {
        ...process.env,
        TELEGRAM_BOT_TOKEN: "telegram-env-token",
      },
    });

    expect(resolved.channels.telegram.accounts.default.botToken).toBe("telegram-file-token");
  });

  test("can materialize only the requested channel credentials", () => {
    const config = createConfig();
    config.channels.slack.enabled = true;
    config.channels.slack.appToken = "${SLACK_APP_TOKEN}";
    config.channels.slack.botToken = "${SLACK_BOT_TOKEN}";
    config.channels.slack.accounts.default = {
      appToken: "${SLACK_APP_TOKEN}",
      botToken: "${SLACK_BOT_TOKEN}",
    };

    const resolved = materializeRuntimeChannelCredentials(config, {
      env: {
        ...process.env,
        TELEGRAM_BOT_TOKEN: "telegram-env-token",
      },
      materializeChannels: ["telegram"],
    });

    expect(resolved.channels.telegram.accounts.default.botToken).toBe("telegram-env-token");
    expect(resolved.channels.telegram.botToken).toBe("telegram-env-token");
    expect(resolved.channels.slack.accounts.default?.appToken).toBe("${SLACK_APP_TOKEN}");
    expect(resolved.channels.slack.accounts.default?.botToken).toBe("${SLACK_BOT_TOKEN}");
    expect(resolved.channels.slack.appToken).toBe("${SLACK_APP_TOKEN}");
    expect(resolved.channels.slack.botToken).toBe("${SLACK_BOT_TOKEN}");
  });

  test("rejects raw persistent config token literals", () => {
    const config = createConfig();
    config.channels.telegram.botToken = "123456:abc";
    config.channels.telegram.accounts.default.botToken = "123456:abc";
    expect(() => validatePersistentChannelCredentials(config)).toThrow(
      "Raw channel token literals are not allowed",
    );
  });
});
