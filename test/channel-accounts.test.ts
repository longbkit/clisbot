import { describe, expect, test } from "bun:test";
import {
  listSlackAccounts,
  resolveSlackAccountConfig,
  resolveTelegramAccountConfig,
} from "../src/config/channel-accounts.ts";
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
        enabled: true,
        mode: "socket",
        appToken: "root-app",
        botToken: "root-bot",
        defaultAccount: "work",
        accounts: {
          work: {
            appToken: "work-app",
            botToken: "work-bot",
          },
        },
        agentPrompt: {
          enabled: true,
          maxProgressMessages: 3,
          requireFinalResponse: true,
        },
        ackReaction: ":heavy_check_mark:",
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
        directMessages: { enabled: true, policy: "open", allowFrom: [], requireMention: false },
      },
      telegram: {
        enabled: true,
        mode: "polling",
        botToken: "root-telegram",
        defaultAccount: "alerts",
        accounts: {
          alerts: {
            botToken: "alerts-token",
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
          policy: "open",
          allowFrom: [],
          requireMention: false,
          allowBots: false,
        },
      },
    },
  };
}

describe("channel accounts", () => {
  test("resolves explicit slack account config", () => {
    const config = createConfig();
    const resolved = resolveSlackAccountConfig(config.channels.slack, "work");
    expect(resolved.accountId).toBe("work");
    expect(resolved.config.botToken).toBe("work-bot");
  });

  test("falls back to root slack tokens when no account map is configured", () => {
    const config = createConfig();
    config.channels.slack.accounts = {};
    const resolved = resolveSlackAccountConfig(config.channels.slack);
    expect(resolved.accountId).toBe("work");
    expect(resolved.config.botToken).toBe("root-bot");
  });

  test("resolves telegram default account config", () => {
    const config = createConfig();
    const resolved = resolveTelegramAccountConfig(config.channels.telegram);
    expect(resolved.accountId).toBe("alerts");
    expect(resolved.config.botToken).toBe("alerts-token");
  });

  test("lists only valid slack accounts", () => {
    const config = createConfig();
    config.channels.slack.accounts.empty = { appToken: "", botToken: "" };
    expect(listSlackAccounts(config.channels.slack).map((entry) => entry.accountId)).toEqual([
      "work",
    ]);
  });
});
