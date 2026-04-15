import { describe, expect, test } from "bun:test";
import { resolveChannelAuth } from "../src/auth/resolve.ts";
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
          admin: { allow: ["configManage", "appAuthManage"], users: ["slack:UADMIN"] },
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
            admin: { allow: ["sendMessage", "shellExecute"], users: ["slack:UOPS"] },
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
            capture: { mode: "off", statusCommand: "/status", pattern: "x", timeoutMs: 1, pollIntervalMs: 1 },
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
        privilegeCommands: { enabled: false, allowUsers: [] },
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
        privilegeCommands: { enabled: false, allowUsers: [] },
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

describe("resolveChannelAuth", () => {
  test("grants app admins pairing bypass and protected-resource management", () => {
    const auth = resolveChannelAuth({
      config: createConfig(),
      agentId: "default",
      identity: {
        platform: "slack",
        conversationKind: "dm",
        senderId: "UADMIN",
      },
    });

    expect(auth.appRole).toBe("admin");
    expect(auth.mayBypassPairing).toBe(true);
    expect(auth.mayManageProtectedResources).toBe(true);
    expect(auth.canUseShell).toBe(true);
  });

  test("grants shell only when the resolved agent role allows it", () => {
    const auth = resolveChannelAuth({
      config: createConfig(),
      agentId: "default",
      identity: {
        platform: "slack",
        conversationKind: "channel",
        senderId: "UOPS",
      },
    });

    expect(auth.appRole).toBe("member");
    expect(auth.agentRole).toBe("admin");
    expect(auth.mayBypassPairing).toBe(false);
    expect(auth.mayManageProtectedResources).toBe(false);
    expect(auth.canUseShell).toBe(true);
  });

  test("keeps inherited permissions when an agent role override only changes users", () => {
    const config = createConfig();
    config.agents.list = [
      {
        id: "default",
        auth: {
          defaultRole: "member",
          roles: {
            member: {
              users: ["slack:U123"],
            },
          },
        },
      },
    ];

    const auth = resolveChannelAuth({
      config,
      agentId: "default",
      identity: {
        platform: "slack",
        conversationKind: "channel",
        senderId: "U123",
      },
    });

    expect(auth.agentRole).toBe("member");
    expect(auth.canUseShell).toBe(false);
  });
});
