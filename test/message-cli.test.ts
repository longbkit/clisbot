import { describe, expect, test } from "bun:test";
import { runMessageCli } from "../src/control/message-cli.ts";
import { resolveSlackConversationRoute } from "../src/channels/slack/route-config.ts";
import { resolveSlackConversationTarget } from "../src/channels/slack/session-routing.ts";
import { resolveTelegramConversationRoute } from "../src/channels/telegram/route-config.ts";
import { resolveTelegramConversationTarget } from "../src/channels/telegram/session-routing.ts";
import type { ChannelPlugin } from "../src/channels/channel-plugin.ts";
import type { ParsedMessageCommand } from "../src/channels/message-command.ts";
import type { LoadConfigOptions, LoadedConfig } from "../src/config/load-config.ts";

function createDependencies() {
  const logs: string[] = [];
  const calls: Array<{ provider: string; action: string; params: unknown }> = [];
  const replyTargets: Array<{
    loadedConfig: LoadedConfig;
    target: unknown;
    kind?: string;
    source?: string;
  }> = [];
  const loadedConfig: LoadedConfig = {
    configPath: "/tmp/clisbot.json",
    processedEventsPath: "/tmp/processed-events.json",
    stateDir: "/tmp/clisbot-state",
    raw: {
      meta: {
        schemaVersion: 1,
      },
      session: {
        mainKey: "main",
        dmScope: "main",
        identityLinks: {},
        storePath: "/tmp/sessions.json",
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
      tmux: {
        socketPath: "/tmp/clisbot.sock",
      },
      agents: {
        defaults: {
          workspace: "/tmp/{agentId}",
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
                pattern: "id",
                timeoutMs: 1,
                pollIntervalMs: 1,
              },
              resume: { mode: "off", args: [] },
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
          defaultAccount: "work",
          accounts: {},
          enabled: true,
          mode: "socket",
          appToken: "",
          botToken: "",
          agentPrompt: {
            enabled: true,
            maxProgressMessages: 3,
            requireFinalResponse: true,
          },
          ackReaction: "",
          typingReaction: "",
          processingStatus: {
            enabled: true,
            status: "Working...",
            loadingMessages: [],
          },
          allowBots: false,
          replyToMode: "thread",
          channelPolicy: "allowlist",
          groupPolicy: "allowlist",
          defaultAgentId: "default",
          commandPrefixes: {
            slash: ["::", "\\"],
            bash: ["!"],
          },
          streaming: "off",
          response: "final",
          responseMode: "message-tool",
          additionalMessageMode: "steer",
          verbose: "minimal",
          followUp: {
            mode: "auto",
            participationTtlMin: 5,
          },
          channels: {
            C123: {
              requireMention: true,
              allowBots: false,
            },
          },
          groups: {},
          directMessages: {
            enabled: true,
            policy: "pairing",
            allowFrom: [],
            requireMention: false,
          },
        },
        telegram: {
          defaultAccount: "ops",
          accounts: {},
          enabled: true,
          mode: "polling",
          botToken: "",
          agentPrompt: {
            enabled: true,
            maxProgressMessages: 3,
            requireFinalResponse: true,
          },
          allowBots: false,
          groupPolicy: "allowlist",
          defaultAgentId: "default",
          commandPrefixes: {
            slash: ["::", "\\"],
            bash: ["!"],
          },
          streaming: "off",
          response: "final",
          responseMode: "message-tool",
          additionalMessageMode: "steer",
          verbose: "minimal",
          followUp: {
            mode: "auto",
            participationTtlMin: 5,
          },
          polling: {
            timeoutSeconds: 20,
            retryDelayMs: 1000,
          },
          groups: {
            "-1001234567890": {
              requireMention: false,
              allowBots: false,
              topics: {},
            },
          },
          directMessages: {
            enabled: true,
            policy: "pairing",
            allowFrom: [],
            requireMention: false,
            allowBots: false,
          },
        },
      },
    },
  };

  const deps = {
    loadConfig: async (_configPath?: string, _options?: LoadConfigOptions) => loadedConfig,
    plugins: [
      {
        id: "slack",
        isEnabled: () => true,
        listAccounts: () => [],
        createRuntimeService: () => {
          throw new Error("not used in message cli tests");
        },
        renderHealthSummary: () => "unused",
        renderActiveHealthSummary: () => "unused",
        markStartupFailure: async () => undefined,
        runMessageCommand: async (_loadedConfig: any, command: ParsedMessageCommand) => {
          const params = {
            botToken: "xoxb-test",
            target: command.target!,
            threadId: command.threadId,
            replyTo: command.replyTo,
            message: command.message,
            media: command.media,
            messageId: command.messageId,
            emoji: command.emoji,
            remove: command.remove,
            limit: command.limit,
            query: command.query,
            pollQuestion: command.pollQuestion,
            pollOptions: command.pollOptions,
            progress: command.progress,
            final: command.final,
          };
          calls.push({ provider: "slack", action: command.action, params });
          return {
            accountId: command.account ?? "work",
            result:
              command.action === "send"
                ? { ok: true, provider: "slack", action: "send" }
                : { ok: true },
          };
        },
        resolveMessageReplyTarget: ({ loadedConfig, command, accountId }) => {
          if (!command.target) {
            return null;
          }
          const normalizedTarget = command.target.startsWith("channel:")
            ? {
                channelType: "channel" as const,
                channelId: command.target.slice("channel:".length),
                conversationKind: "channel" as const,
              }
            : null;
          if (!normalizedTarget) {
            return null;
          }
          const resolved = resolveSlackConversationRoute(
            loadedConfig,
            {
              channel_type: normalizedTarget.channelType,
              channel: normalizedTarget.channelId,
            },
            { accountId },
          );
          if (!resolved.route) {
            return null;
          }
          return resolveSlackConversationTarget({
            loadedConfig,
            agentId: resolved.route.agentId,
            accountId,
            channelId: normalizedTarget.channelId,
            conversationKind: normalizedTarget.conversationKind,
            threadTs: command.threadId ?? command.replyTo,
            messageTs: command.replyTo ?? command.threadId,
            replyToMode: resolved.route.replyToMode,
          });
        },
      },
      {
        id: "telegram",
        isEnabled: () => true,
        listAccounts: () => [],
        createRuntimeService: () => {
          throw new Error("not used in message cli tests");
        },
        renderHealthSummary: () => "unused",
        renderActiveHealthSummary: () => "unused",
        markStartupFailure: async () => undefined,
        runMessageCommand: async (_loadedConfig: any, command: ParsedMessageCommand) => {
          const params =
            command.action === "read" || command.action === "reactions" || command.action === "search"
              ? command.action
              : {
                  botToken: "telegram-test",
                  target: command.target!,
                  threadId: command.threadId,
                  replyTo: command.replyTo,
                  message: command.message,
                  media: command.media,
                  messageId: command.messageId,
                  emoji: command.emoji,
                  remove: command.remove,
                  limit: command.limit,
                  query: command.query,
                  pollQuestion: command.pollQuestion,
                  pollOptions: command.pollOptions,
                  forceDocument: command.forceDocument,
                  silent: command.silent,
                  progress: command.progress,
                  final: command.final,
                };
          calls.push({
            provider: "telegram",
            action:
              command.action === "read" || command.action === "reactions" || command.action === "search"
                ? "unsupported"
                : command.action,
            params,
          });
          return {
            accountId: command.account ?? "ops",
            result:
              command.action === "read" || command.action === "reactions" || command.action === "search"
                ? { ok: false, action: command.action }
                : command.action === "send"
                  ? { ok: true, provider: "telegram", action: "send" }
                  : { ok: true },
          };
        },
        resolveMessageReplyTarget: ({ loadedConfig, command, accountId }) => {
          if (!command.target) {
            return null;
          }
          const chatId = Number(command.target);
          if (!Number.isFinite(chatId)) {
            return null;
          }
          const topicId = command.threadId ? Number(command.threadId) : undefined;
          const resolved = resolveTelegramConversationRoute({
            loadedConfig,
            chatType: chatId > 0 ? "private" : "supergroup",
            chatId,
            topicId: Number.isFinite(topicId) ? topicId : undefined,
            isForum: Number.isFinite(topicId),
            accountId,
          });
          if (!resolved.route) {
            return null;
          }
          return resolveTelegramConversationTarget({
            loadedConfig,
            agentId: resolved.route.agentId,
            accountId,
            chatId,
            userId: chatId > 0 ? chatId : undefined,
            conversationKind:
              resolved.conversationKind === "topic"
                ? "topic"
                : resolved.conversationKind === "dm"
                  ? "dm"
                  : "group",
            topicId: Number.isFinite(topicId) ? topicId : undefined,
          });
        },
      },
    ] satisfies ChannelPlugin[],
    print: (text: string) => {
      logs.push(text);
    },
    recordConversationReply: async (params: {
      loadedConfig: LoadedConfig;
      target: unknown;
      kind?: string;
      source?: string;
    }) => {
      replyTargets.push(params);
    },
  };

  return { deps, logs, calls, replyTargets };
}

describe("message cli", () => {
  test("prints help when no message subcommand is provided", async () => {
    const { deps, logs, calls, replyTargets } = createDependencies();

    await runMessageCli([], deps);

    expect(calls).toHaveLength(0);
    expect(logs[0]).toContain("clisbot message");
    expect(logs[0]).toContain("message send");
  });

  test("routes slack send through the resolved account config", async () => {
    const { deps, logs, calls, replyTargets } = createDependencies();

    await runMessageCli([
      "send",
      "--channel",
      "slack",
      "--account",
      "alerts",
      "--target",
      "channel:C123",
      "--message",
      "hello",
      "--thread-id",
      "171234.000100",
      "--reply-to",
      "171234.000099",
      "--media",
      "report.png",
      "--json",
    ], deps);

    expect(calls).toEqual([
      {
        provider: "slack",
        action: "send",
        params: {
          botToken: "xoxb-test",
          target: "channel:C123",
          threadId: "171234.000100",
          replyTo: "171234.000099",
          message: "hello",
          media: "report.png",
          messageId: undefined,
          emoji: undefined,
          remove: false,
          limit: undefined,
          query: undefined,
          pollQuestion: undefined,
          pollOptions: [],
          progress: false,
          final: false,
        },
      },
    ]);
    expect(logs).toEqual([
      JSON.stringify({ ok: true, provider: "slack", action: "send" }, null, 2),
    ]);
    expect(replyTargets).toHaveLength(1);
    expect(replyTargets[0]?.target).toEqual({
      agentId: "default",
      sessionKey: "agent:default:slack:channel:c123:thread:171234.000100",
      mainSessionKey: "agent:default:main",
      parentSessionKey: "agent:default:slack:channel:c123",
      threadId: "171234.000100",
    });
    expect(replyTargets[0]?.kind).toBe("reply");
  });

  test("routes telegram unsupported history actions through the provider guard", async () => {
    const { deps, logs, calls } = createDependencies();

    await runMessageCli([
      "read",
      "--channel",
      "telegram",
      "--target",
      "-1001234567890",
      "--account",
      "ops",
    ], deps);

    expect(calls).toEqual([
      {
        provider: "telegram",
        action: "unsupported",
        params: "read",
      },
    ]);
    expect(logs).toEqual([JSON.stringify({ ok: false, action: "read" }, null, 2)]);
  });

  test("requires --target for actionable commands", async () => {
    const { deps } = createDependencies();

    await expect(
      runMessageCli(["send", "--channel", "slack", "--message", "hello"], deps),
    ).rejects.toThrow("--target is required");
  });

  test("requires a supported channel value", async () => {
    const { deps } = createDependencies();

    await expect(
      runMessageCli(["send", "--channel", "discord", "--target", "general"], deps),
    ).rejects.toThrow("--channel <slack|telegram> is required");
  });

  test("does not stamp follow-up state for non-reply history actions", async () => {
    const { deps, replyTargets } = createDependencies();

    await runMessageCli([
      "search",
      "--channel",
      "slack",
      "--target",
      "channel:C123",
      "--query",
      "hello",
    ], deps);

    expect(replyTargets).toHaveLength(0);
  });

  test("marks final reply sends explicitly", async () => {
    const { deps, replyTargets } = createDependencies();

    await runMessageCli([
      "send",
      "--channel",
      "slack",
      "--target",
      "channel:C123",
      "--message",
      "done",
      "--final",
    ], deps);

    expect(replyTargets).toHaveLength(1);
    expect(replyTargets[0]?.kind).toBe("final");
  });

  test("marks routed message sends as message-tool replies", async () => {
    const { deps, replyTargets } = createDependencies();

    await runMessageCli([
      "send",
      "--channel",
      "telegram",
      "--target",
      "-1001234567890",
      "--message",
      "working on it",
      "--progress",
    ], deps);

    expect(replyTargets).toHaveLength(1);
    expect(replyTargets[0]?.kind).toBe("progress");
    expect(replyTargets[0]?.source).toBe("message-tool");
  });

  test("loads config with materialization scoped to the requested channel", async () => {
    const { deps } = createDependencies();
    const captured: Array<LoadConfigOptions | undefined> = [];

    await runMessageCli(
      [
        "send",
        "--channel",
        "telegram",
        "--target",
        "-1001234567890",
        "--message",
        "hello",
      ],
      {
        ...deps,
        loadConfig: async (_configPath?: string, options?: LoadConfigOptions) => {
          captured.push(options);
          return deps.loadConfig();
        },
      },
    );

    expect(captured).toEqual([
      {
        materializeChannels: ["telegram"],
      },
    ]);
  });

  test("rejects conflicting progress and final flags", async () => {
    const { deps } = createDependencies();

    await expect(
      runMessageCli([
        "send",
        "--channel",
        "slack",
        "--target",
        "channel:C123",
        "--message",
        "done",
        "--progress",
        "--final",
      ], deps),
    ).rejects.toThrow("--progress and --final cannot be used together");
  });

  test("uses only injected plugins and fails when the requested plugin is absent", async () => {
    const { deps } = createDependencies();

    await expect(
      runMessageCli(
        ["send", "--channel", "slack", "--target", "channel:C123", "--message", "hello"],
        {
          ...deps,
          plugins: deps.plugins.filter((plugin) => plugin.id !== "slack"),
        },
      ),
    ).rejects.toThrow("Unsupported message channel: slack");
  });
});
