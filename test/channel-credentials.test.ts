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
import { deactivateExpiredMemAccounts } from "../src/config/channel-account-management.ts";
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
    agents: {
      defaults: {
        workspace: "~/.clisbot/workspaces/{agentId}",
        runner: {
          command: "codex",
          args: ["-C", "{workspace}"],
          trustWorkspace: true,
          startupDelayMs: 1,
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
        privilegeCommands: { enabled: false, allowUsers: [] },
        commandPrefixes: { slash: ["::"], bash: ["!"] },
        streaming: "all",
        response: "final",
        responseMode: "message-tool",
        additionalMessageMode: "steer",
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
        privilegeCommands: { enabled: false, allowUsers: [] },
        commandPrefixes: { slash: ["::"], bash: ["!"] },
        streaming: "all",
        response: "final",
        responseMode: "message-tool",
        additionalMessageMode: "steer",
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

  test("rejects raw persistent config token literals", () => {
    const config = createConfig();
    config.channels.telegram.botToken = "123456:abc";
    config.channels.telegram.accounts.default.botToken = "123456:abc";
    expect(() => validatePersistentChannelCredentials(config)).toThrow(
      "Raw channel token literals are not allowed",
    );
  });
});
