import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runMessageCli } from "../src/control/message-cli.ts";
import { resolveSlackConversationRoute } from "../src/channels/slack/route-config.ts";
import { resolveSlackConversationTarget } from "../src/channels/slack/session-routing.ts";
import { resolveTelegramConversationRoute } from "../src/channels/telegram/route-config.ts";
import { resolveTelegramConversationTarget } from "../src/channels/telegram/session-routing.ts";
import type { ChannelPlugin } from "../src/channels/channel-plugin.ts";
import type { ParsedMessageCommand } from "../src/channels/message-command.ts";
import type { LoadConfigOptions, LoadedConfig } from "../src/config/load-config.ts";
import { clisbotConfigSchema } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";

let previousCliName: string | undefined;

beforeEach(() => {
  previousCliName = process.env.CLISBOT_CLI_NAME;
  delete process.env.CLISBOT_CLI_NAME;
});

afterEach(() => {
  process.env.CLISBOT_CLI_NAME = previousCliName;
});

function createRawConfig(): LoadedConfig["raw"] {
  const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
  config.app.session.storePath = "/tmp/sessions.json";
  config.agents.defaults.workspace = "/tmp/{agentId}";
  config.agents.defaults.runner.defaults.tmux.socketPath = "/tmp/clisbot.sock";
  config.agents.defaults.runner.defaults.startupDelayMs = 1;
  config.agents.defaults.runner.defaults.startupRetryCount = 2;
  config.agents.defaults.runner.defaults.startupRetryDelayMs = 0;
  config.agents.defaults.runner.defaults.promptSubmitDelayMs = 1;
  config.agents.defaults.runner.codex.sessionId!.capture = {
    mode: "off",
    statusCommand: "/status",
    pattern: "id",
    timeoutMs: 1,
    pollIntervalMs: 1,
  };
  config.agents.defaults.runner.defaults.stream.captureLines = 10;
  config.agents.defaults.runner.defaults.stream.updateIntervalMs = 10;
  config.agents.defaults.runner.defaults.stream.idleTimeoutMs = 10;
  config.agents.defaults.runner.defaults.stream.noOutputTimeoutMs = 10;
  config.agents.defaults.runner.defaults.stream.maxRuntimeSec = 10;
  config.agents.defaults.runner.defaults.stream.maxRuntimeMin = undefined;
  config.agents.defaults.runner.defaults.stream.maxMessageChars = 100;
  config.agents.list = [{ id: "default" }];
  config.app.control.configReload.watch = false;
  config.bots.slack.defaults.enabled = true;
  config.bots.slack.defaults.defaultBotId = "work";
  config.bots.slack.defaults.channelPolicy = "allowlist";
  config.bots.slack.defaults.groupPolicy = "allowlist";
  config.bots.slack.work = {
    ...config.bots.slack.default,
    enabled: true,
    name: "work",
    groups: {
      "channel:C123": {
        enabled: true,
        requireMention: true,
        allowBots: false,
        allowUsers: [],
        blockUsers: [],
      },
    },
  };
  config.bots.slack.alerts = {
    ...config.bots.slack.default,
    enabled: true,
    name: "alerts",
    groups: {
      "channel:C123": {
        enabled: true,
        requireMention: true,
        allowBots: false,
        allowUsers: [],
        blockUsers: [],
      },
    },
  };
  delete config.bots.slack.default;
  config.bots.telegram.defaults.enabled = true;
  config.bots.telegram.defaults.defaultBotId = "ops";
  config.bots.telegram.defaults.groupPolicy = "allowlist";
  config.bots.telegram.ops = {
    ...config.bots.telegram.default,
    enabled: true,
    name: "ops",
    groups: {
      "-1001234567890": {
        enabled: true,
        requireMention: false,
        allowBots: false,
        allowUsers: [],
        blockUsers: [],
        topics: {},
      },
    },
  };
  delete config.bots.telegram.default;
  return {
    ...config,
    session: {
      ...config.app.session,
      dmScope: config.bots.defaults.dmScope,
    },
    control: config.app.control,
    tmux: config.agents.defaults.runner.defaults.tmux,
  };
}

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
    raw: createRawConfig(),
  };

  const deps = {
    loadConfig: async (_configPath?: string, _options?: LoadConfigOptions) => loadedConfig,
    plugins: [
      {
        id: "slack",
        isEnabled: () => true,
        listBots: () => [],
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
          inputFormat: command.inputFormat,
          renderMode: command.renderMode,
          progress: command.progress,
          final: command.final,
        };
          calls.push({ provider: "slack", action: command.action, params });
          return {
            botId: command.account ?? "work",
            result:
              command.action === "send"
                ? { ok: true, provider: "slack", action: "send" }
                : { ok: true },
          };
        },
        resolveMessageReplyTarget: ({ loadedConfig, command, botId }) => {
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
            { accountId: botId },
          );
          if (!resolved.route) {
            return null;
          }
          return resolveSlackConversationTarget({
            loadedConfig,
            agentId: resolved.route.agentId,
            accountId: botId,
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
        listBots: () => [],
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
                  inputFormat: command.inputFormat,
                  renderMode: command.renderMode,
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
            botId: command.account ?? "ops",
            result:
              command.action === "read" || command.action === "reactions" || command.action === "search"
                ? { ok: false, action: command.action }
                : command.action === "send"
                  ? { ok: true, provider: "telegram", action: "send" }
                  : { ok: true },
          };
        },
        resolveMessageReplyTarget: ({ loadedConfig, command, botId }) => {
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
            accountId: botId,
          });
          if (!resolved.route) {
            return null;
          }
          return resolveTelegramConversationTarget({
            loadedConfig,
            agentId: resolved.route.agentId,
            accountId: botId,
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
    expect(logs[0]).toContain("--body-file");
    expect(logs[0]).toContain("--message-file");
    expect(logs[0]).toContain("--file <path-or-url>");
    expect(logs[0]).toContain("--media (compat only)");
    expect(logs[0]).toContain("--input <plain|md|html|mrkdwn|blocks>");
    expect(logs[0]).toContain("--render <native|none|html|mrkdwn|blocks>");
    expect(logs[0]).toContain("--topic-id <telegram-topic-id>");
    expect(logs[0]).toContain("Telegram topic id");
    expect(logs[0]).toContain("Render Rules:");
    expect(logs[0]).toContain("Final payload must stay under 4096 chars");
    expect(logs[0]).toContain("Prefer text under 4000 chars");
    expect(logs[0]).toContain("Max 50 blocks; keep header text under 150 and section text under 3000");
  });

  test("routes telegram send with --topic-id through the resolved bot config", async () => {
    const { deps, logs, calls, replyTargets } = createDependencies();

    await runMessageCli([
      "send",
      "--channel",
      "telegram",
      "--account",
      "ops",
      "--target",
      "-1001234567890",
      "--topic-id",
      "42",
      "--message",
      "hello",
      "--json",
    ], deps);

    expect(calls).toContainEqual({
      provider: "telegram",
      action: "send",
      params: {
        botToken: "telegram-test",
        target: "-1001234567890",
        threadId: "42",
        replyTo: undefined,
        message: "hello",
        media: undefined,
        messageId: undefined,
        emoji: undefined,
        remove: false,
        limit: undefined,
        query: undefined,
        pollQuestion: undefined,
        pollOptions: [],
        forceDocument: false,
        silent: false,
        inputFormat: "md",
        renderMode: "native",
        progress: false,
        final: false,
      },
    });
    expect(logs).toEqual([
      JSON.stringify({ ok: true, provider: "telegram", action: "send" }, null, 2),
    ]);
    expect((replyTargets[0]?.target as { sessionKey?: string } | undefined)?.sessionKey).toBe(
      "agent:default:telegram:group:-1001234567890:topic:42",
    );
  });

  test("routes slack send through the resolved bot config", async () => {
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
          inputFormat: "md",
          renderMode: "native",
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

  test("accepts --file as the preferred attachment flag", async () => {
    const { deps, calls } = createDependencies();

    await runMessageCli([
      "send",
      "--channel",
      "slack",
      "--target",
      "channel:C123",
      "--message",
      "hello",
      "--file",
      "report.pdf",
    ], deps);

    expect(calls[0]).toEqual({
      provider: "slack",
      action: "send",
      params: {
        botToken: "xoxb-test",
        target: "channel:C123",
        threadId: undefined,
        replyTo: undefined,
        message: "hello",
        media: "report.pdf",
        messageId: undefined,
        emoji: undefined,
        remove: false,
        limit: undefined,
        query: undefined,
        pollQuestion: undefined,
        pollOptions: [],
        inputFormat: "md",
        renderMode: "native",
        progress: false,
        final: false,
      },
    });
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

  test("loads message body from --body-file", async () => {
    const { deps, calls } = createDependencies();
    const messageFile = "/tmp/clisbot-message-cli-test.txt";
    await Bun.write(messageFile, "hello from file");

    await runMessageCli(
      [
        "send",
        "--channel",
        "telegram",
        "--target",
        "-1001234567890",
        "--body-file",
        messageFile,
      ],
      deps,
    );

    expect(calls[0]).toEqual({
      provider: "telegram",
      action: "send",
      params: {
        botToken: "telegram-test",
        target: "-1001234567890",
        threadId: undefined,
        replyTo: undefined,
        message: "hello from file",
        media: undefined,
        messageId: undefined,
        emoji: undefined,
        remove: false,
        limit: undefined,
        query: undefined,
        pollQuestion: undefined,
        pollOptions: [],
        forceDocument: false,
        silent: false,
        inputFormat: "md",
        renderMode: "native",
        progress: false,
        final: false,
      },
    });
  });

  test("keeps --message-file as a compatibility alias", async () => {
    const { deps, calls } = createDependencies();
    const messageFile = "/tmp/clisbot-message-cli-test-compat.txt";
    await Bun.write(messageFile, "hello from compat alias");

    await runMessageCli(
      [
        "send",
        "--channel",
        "telegram",
        "--target",
        "-1001234567890",
        "--message-file",
        messageFile,
      ],
      deps,
    );

    expect(calls[0]).toEqual({
      provider: "telegram",
      action: "send",
      params: {
        botToken: "telegram-test",
        target: "-1001234567890",
        threadId: undefined,
        replyTo: undefined,
        message: "hello from compat alias",
        media: undefined,
        messageId: undefined,
        emoji: undefined,
        remove: false,
        limit: undefined,
        query: undefined,
        pollQuestion: undefined,
        pollOptions: [],
        forceDocument: false,
        silent: false,
        inputFormat: "md",
        renderMode: "native",
        progress: false,
        final: false,
      },
    });
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

  test("rejects using --file together with --media", async () => {
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
        "--file",
        "report.pdf",
        "--media",
        "report.png",
      ], deps),
    ).rejects.toThrow("--file and --media are aliases; use only one");
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
