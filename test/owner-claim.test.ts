import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  claimFirstOwnerFromDirectMessage,
  isOwnerClaimOpen,
  primeOwnerClaimRuntime,
  renderFirstOwnerClaimMessage,
  resetOwnerClaimRuntimeForTests,
} from "../src/auth/owner-claim.ts";
import { readEditableConfig, writeEditableConfig } from "../src/config/config-file.ts";
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
          admin: { allow: ["configManage", "appAuthManage"], users: [] },
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
            admin: { allow: ["sendMessage", "shellExecute"], users: [] },
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
      list: [{ id: "default" }],
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
        agentPrompt: { enabled: true, maxProgressMessages: 3, requireFinalResponse: true },
        allowBots: false,
        ackReaction: "",
        typingReaction: "",
        processingStatus: { enabled: true, status: "Working...", loadingMessages: [] },
        replyToMode: "thread",
        channelPolicy: "allowlist",
        groupPolicy: "allowlist",
        defaultAgentId: "default",
        commandPrefixes: { slash: ["::", "\\"], bash: ["!"] },
        streaming: "all",
        response: "final",
        responseMode: "message-tool",
        additionalMessageMode: "steer",
        verbose: "minimal",
        followUp: { mode: "auto", participationTtlMin: 5 },
        channels: {},
        groups: {},
        directMessages: {
          enabled: true,
          policy: "pairing",
          allowFrom: [],
          requireMention: false,
          agentId: "default",
        },
      },
      telegram: {
        enabled: false,
        mode: "polling",
        botToken: "",
        defaultAccount: "default",
        accounts: {},
        agentPrompt: { enabled: true, maxProgressMessages: 3, requireFinalResponse: true },
        allowBots: false,
        groupPolicy: "allowlist",
        defaultAgentId: "default",
        commandPrefixes: { slash: ["::", "\\"], bash: ["!"] },
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
          agentId: "default",
        },
      },
    },
  };
}

describe("owner claim", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    resetOwnerClaimRuntimeForTests();
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-owner-claim-"));
    configPath = join(tempDir, "clisbot.json");
    await writeEditableConfig(configPath, createConfig());
  });

  afterEach(() => {
    resetOwnerClaimRuntimeForTests();
  });

  test("claims the first owner from the first DM during the claim window", async () => {
    const { config } = await readEditableConfig(configPath);

    primeOwnerClaimRuntime(config, 1_000);
    const result = await claimFirstOwnerFromDirectMessage({
      config,
      configPath,
      identity: {
        platform: "telegram",
        conversationKind: "dm",
        senderId: "1276408333",
        chatId: "1276408333",
      },
      nowMs: 5_000,
    });

    expect(result).toMatchObject({
      claimed: true,
      principal: "telegram:1276408333",
    });
    expect(config.app.auth.roles.owner.users).toEqual(["telegram:1276408333"]);

    const persisted = await readEditableConfig(configPath);
    expect(persisted.config.app.auth.roles.owner.users).toEqual([
      "telegram:1276408333",
    ]);
    expect(isOwnerClaimOpen(config, 5_001)).toBe(false);
  });

  test("does not claim outside direct messages", async () => {
    const { config } = await readEditableConfig(configPath);

    primeOwnerClaimRuntime(config, 1_000);
    const result = await claimFirstOwnerFromDirectMessage({
      config,
      configPath,
      identity: {
        platform: "slack",
        conversationKind: "channel",
        senderId: "U123",
        channelId: "C123",
      },
      nowMs: 2_000,
    });

    expect(result.claimed).toBe(false);
    expect(config.app.auth.roles.owner.users).toEqual([]);
  });

  test("does not reopen owner claim until the next runtime after an owner existed", async () => {
    const { config } = await readEditableConfig(configPath);

    primeOwnerClaimRuntime(config, 1_000);
    await claimFirstOwnerFromDirectMessage({
      config,
      configPath,
      identity: {
        platform: "slack",
        conversationKind: "dm",
        senderId: "UOWNER",
        channelId: "D123",
      },
      nowMs: 2_000,
    });

    config.app.auth.roles.owner.users = [];
    const result = await claimFirstOwnerFromDirectMessage({
      config,
      configPath,
      identity: {
        platform: "telegram",
        conversationKind: "dm",
        senderId: "555",
        chatId: "555",
      },
      nowMs: 3_000,
    });

    expect(result.claimed).toBe(false);
    expect(config.app.auth.roles.owner.users).toEqual([]);
  });

  test("expires the owner claim window without mutating config", async () => {
    const { config } = await readEditableConfig(configPath);

    primeOwnerClaimRuntime(config, 0);
    const result = await claimFirstOwnerFromDirectMessage({
      config,
      configPath,
      identity: {
        platform: "slack",
        conversationKind: "dm",
        senderId: "ULATE",
        channelId: "D1",
      },
      nowMs: 30 * 60_000 + 1,
    });

    expect(result.claimed).toBe(false);
    expect(config.app.auth.roles.owner.users).toEqual([]);
  });

  test("renders a clear first-owner claim acknowledgement", () => {
    const text = renderFirstOwnerClaimMessage({
      principal: "telegram:1276408333",
      ownerClaimWindowMinutes: 30,
    });

    expect(text).toContain("First owner claim complete.");
    expect(text).toContain("principal: `telegram:1276408333`");
    expect(text).toContain("role: `owner`");
    expect(text).toContain("first direct message received during the first 30 minutes");
    expect(text).toContain("pairing: not required for you anymore because app owners bypass DM pairing");
    expect(text).toContain("- chat without pairing approval");
    expect(text).toContain("- manage auth, channels, and agent settings");
  });
});
