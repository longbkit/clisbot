import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runMessageCli } from "../../src/control/message-cli.ts";
import { resolveSlackConversationRoute } from "../../src/channels/slack/route-config.ts";
import { resolveSlackConversationTarget } from "../../src/channels/slack/session-routing.ts";
import { resolveTelegramConversationRoute } from "../../src/channels/telegram/route-config.ts";
import { resolveTelegramConversationTarget } from "../../src/channels/telegram/session-routing.ts";
import type { ChannelPlugin } from "../../src/channels/channel-plugin.ts";
import type { ParsedMessageCommand } from "../../src/channels/message-command.ts";
import type { LoadConfigOptions, LoadedConfig } from "../../src/config/load-config.ts";
import { clisbotConfigSchema } from "../../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../../src/config/template.ts";
import { createDependencies, createRawConfig, normalizeSlackFollowUpTarget } from "./message-cli-support.ts";

let previousCliName: string | undefined;

beforeEach(() => {
  previousCliName = process.env.CLISBOT_CLI_NAME;
  delete process.env.CLISBOT_CLI_NAME;
});

afterEach(() => {
  process.env.CLISBOT_CLI_NAME = previousCliName;
});

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
    expect(logs[0]).toContain("Zalo Bot `--target` is the string chat id");
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
      "group:C123",
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
          target: "group:C123",
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
      "group:C123",
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
        target: "group:C123",
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
    ).rejects.toThrow("--channel <slack|telegram|zalo-bot> is required");
  });

  test("routes zalo-bot send through the resolved bot config", async () => {
    const { deps, logs, calls, replyTargets } = createDependencies();

    await runMessageCli([
      "send",
      "--channel",
      "zalo-bot",
      "--account",
      "default",
      "--target",
      "user-123",
      "--message",
      "hello zalo",
      "--json",
    ], deps);

    expect(calls).toContainEqual({
      provider: "zalo-bot",
      action: "send",
      params: {
        botToken: "zalo-bot-test",
        target: "user-123",
        threadId: undefined,
        replyTo: undefined,
        message: "hello zalo",
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
      JSON.stringify({ ok: true, provider: "zalo-bot", action: "send" }, null, 2),
    ]);
    expect((replyTargets[0]?.target as { sessionKey?: string } | undefined)?.sessionKey).toBe(
      "agent:default:zalo-bot:dm:user-123",
    );
  });

  test("rejects thread-id for zalo-bot message commands", async () => {
    const { deps } = createDependencies();

    await expect(
      runMessageCli([
        "send",
        "--channel",
        "zalo-bot",
        "--target",
        "user-123",
        "--thread-id",
        "abc",
        "--message",
        "hello",
      ], deps),
    ).rejects.toThrow("Zalo Bot message commands do not support --thread-id or --topic-id.");
  });

  test("rejects topic-id for zalo-bot message commands", async () => {
    const { deps } = createDependencies();

    await expect(
      runMessageCli([
        "send",
        "--channel",
        "zalo-bot",
        "--target",
        "user-123",
        "--topic-id",
        "42",
        "--message",
        "hello",
      ], deps),
    ).rejects.toThrow("Zalo Bot message commands do not support --thread-id or --topic-id.");
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
