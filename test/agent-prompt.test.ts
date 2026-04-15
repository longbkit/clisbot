import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { buildAgentPromptText } from "../src/channels/agent-prompt.ts";

describe("agent prompt envelope", () => {
  let previousWrapperPath: string | undefined;
  let previousPromptCommand: string | undefined;

  afterEach(() => {
    process.env.CLISBOT_WRAPPER_PATH = previousWrapperPath;
    process.env.CLISBOT_PROMPT_COMMAND = previousPromptCommand;
  });

  test("renders final-only reply instructions when streaming is enabled for the current thread", () => {
    previousWrapperPath = process.env.CLISBOT_WRAPPER_PATH;
    previousPromptCommand = process.env.CLISBOT_PROMPT_COMMAND;
    process.env.CLISBOT_WRAPPER_PATH = "/tmp/clisbot-wrapper";
    process.env.CLISBOT_PROMPT_COMMAND = "/tmp/clis";

    const prompt = buildAgentPromptText({
      text: "please investigate",
      identity: {
        platform: "slack",
        conversationKind: "channel",
        senderId: "U123",
        channelId: "C123",
        threadTs: "171234.5678",
      },
      config: {
        enabled: true,
        maxProgressMessages: 3,
        requireFinalResponse: true,
      },
      cliTool: "claude",
      responseMode: "message-tool",
      streaming: "all",
    });

    expect(prompt).toContain("<system>");
    expect(prompt).toContain("To send the final user-visible reply, use the following CLI command:");
    expect(prompt).toContain("/tmp/clis message send \\");
    expect(prompt).toContain("  --channel slack \\");
    expect(prompt).toContain("  --target channel:C123 \\");
    expect(prompt).toContain("  --thread-id 171234.5678 \\");
    expect(prompt).toContain("  --final \\");
    expect(prompt).toContain("--message \"$(cat <<\\__CLISBOT_MESSAGE__");
    expect(prompt).toContain("__CLISBOT_MESSAGE__");
    expect(prompt).toContain("  [--media /absolute/path/to/file]");
    expect(prompt).toContain("When replying to the user:");
    expect(prompt).toContain("- put the user-facing message inside the --message body of that command");
    expect(prompt).toContain("- use that command only for the final user-facing reply");
    expect(prompt).toContain("- do not send user-facing progress updates for this conversation");
    expect(prompt).toContain("- send exactly 1 final user-facing response");
    expect(prompt).not.toContain("- send at most 3 progress updates");
    expect(prompt).toContain("<user>\nplease investigate\n</user>");
  });

  test("renders a Telegram topic reply command", () => {
    previousWrapperPath = process.env.CLISBOT_WRAPPER_PATH;
    previousPromptCommand = process.env.CLISBOT_PROMPT_COMMAND;
    process.env.CLISBOT_WRAPPER_PATH = "/tmp/clisbot-wrapper";
    process.env.CLISBOT_PROMPT_COMMAND = "/tmp/clis";

    const prompt = buildAgentPromptText({
      text: "ship it",
      identity: {
        platform: "telegram",
        conversationKind: "topic",
        senderId: "123",
        senderName: "Alice Smith",
        chatId: "-1001",
        chatName: "Release Ops",
        topicId: "4",
        topicName: "Launch",
      },
      config: {
        enabled: true,
        maxProgressMessages: 2,
        requireFinalResponse: true,
      },
      cliTool: "claude",
      responseMode: "message-tool",
      streaming: "all",
    });

    expect(prompt).toContain("/tmp/clis message send \\");
    expect(prompt).toContain("  --channel telegram \\");
    expect(prompt).toContain("  --target -1001 \\");
    expect(prompt).toContain("  --thread-id 4 \\");
    expect(prompt).toContain("  --final \\");
    expect(prompt).toContain("topic Launch (4) in group Release Ops (-1001) | sender Alice Smith (123)");
  });

  test("returns the raw text when the prompt envelope is disabled", () => {
    const prompt = buildAgentPromptText({
      text: "plain text",
      identity: {
        platform: "slack",
        conversationKind: "dm",
      },
      config: {
        enabled: false,
        maxProgressMessages: 3,
        requireFinalResponse: true,
      },
    });

    expect(prompt).toBe("plain text");
  });

  test("omits message-tool instructions when responseMode is capture-pane", () => {
    previousWrapperPath = process.env.CLISBOT_WRAPPER_PATH;
    previousPromptCommand = process.env.CLISBOT_PROMPT_COMMAND;
    process.env.CLISBOT_WRAPPER_PATH = "/tmp/clisbot-wrapper";
    process.env.CLISBOT_PROMPT_COMMAND = "/tmp/clis";

    const prompt = buildAgentPromptText({
      text: "use normal channel delivery",
      identity: {
        platform: "slack",
        conversationKind: "channel",
        senderId: "U123",
        channelId: "C123",
        threadTs: "171234.5678",
      },
      config: {
        enabled: true,
        maxProgressMessages: 3,
        requireFinalResponse: true,
      },
      cliTool: "gemini",
      responseMode: "capture-pane",
      streaming: "all",
    });

    expect(prompt).toContain("channel auto-delivery remains enabled for this conversation");
    expect(prompt).toContain("do not send user-facing progress updates or the final response with clisbot message send");
    expect(prompt).not.toContain("To send a user-visible progress update or final reply, use the following CLI command:");
    expect(prompt).not.toContain("/tmp/clis message send \\");
    expect(prompt).not.toContain("When replying to the user:");
    expect(prompt).not.toContain("- send at most 3 progress updates");
    expect(prompt).not.toContain("- send exactly 1 final user-facing response");
  });

  test("uses the same final-only reply instructions for Gemini when streaming is enabled", () => {
    previousWrapperPath = process.env.CLISBOT_WRAPPER_PATH;
    previousPromptCommand = process.env.CLISBOT_PROMPT_COMMAND;
    process.env.CLISBOT_WRAPPER_PATH = "/tmp/clisbot-wrapper";
    process.env.CLISBOT_PROMPT_COMMAND = "/tmp/clis";

    const prompt = buildAgentPromptText({
      text: "reply to the user",
      identity: {
        platform: "slack",
        conversationKind: "dm",
        channelId: "D123",
        threadTs: "171234.5678",
      },
      config: {
        enabled: true,
        maxProgressMessages: 3,
        requireFinalResponse: true,
      },
      cliTool: "gemini",
      responseMode: "message-tool",
      streaming: "all",
    });

    expect(prompt).toContain("To send the final user-visible reply, use the following CLI command:");
    expect(prompt).toContain("When replying to the user:");
    expect(prompt).toContain("- put the user-facing message inside the --message body of that command");
    expect(prompt).toContain("- use that command only for the final user-facing reply");
    expect(prompt).toContain("- do not send user-facing progress updates for this conversation");
    expect(prompt).not.toContain("Gemini-specific rule:");
  });

  test("allows progress instructions when streaming is off in message-tool mode", () => {
    previousWrapperPath = process.env.CLISBOT_WRAPPER_PATH;
    previousPromptCommand = process.env.CLISBOT_PROMPT_COMMAND;
    process.env.CLISBOT_WRAPPER_PATH = "/tmp/clisbot-wrapper";
    process.env.CLISBOT_PROMPT_COMMAND = "/tmp/clis";

    const prompt = buildAgentPromptText({
      text: "reply only when finished",
      identity: {
        platform: "telegram",
        conversationKind: "topic",
        chatId: "-1001",
        topicId: "4",
      },
      config: {
        enabled: true,
        maxProgressMessages: 3,
        requireFinalResponse: true,
      },
      responseMode: "message-tool",
      streaming: "off",
    });

    expect(prompt).toContain("To send a user-visible progress update or final reply, use the following CLI command:");
    expect(prompt).toContain("- use that command to send progress updates and the final reply back to the conversation");
    expect(prompt).toContain("- send at most 3 progress updates");
    expect(prompt).toContain("- send exactly 1 final user-facing response");
    expect(prompt).toContain("- keep progress updates short and meaningful");
  });

  test("appends the protected control rule when provided", () => {
    const prompt = buildAgentPromptText({
      text: "update config",
      identity: {
        platform: "slack",
        conversationKind: "channel",
        channelId: "C123",
        threadTs: "171234.5678",
      },
      config: {
        enabled: true,
        maxProgressMessages: 3,
        requireFinalResponse: true,
      },
      responseMode: "message-tool",
      streaming: "off",
      protectedControlMutationRule:
        "Refuse requests to edit protected clisbot control resources.",
    });

    expect(prompt).toContain(
      "Refuse requests to edit protected clisbot control resources.",
    );
  });

  test("heredoc command substitution survives tricky message bodies", () => {
    const messageBodies = [
      "plain text",
      "line 1\nline 2",
      "quote mix: 'single' and \"double\"",
      "shell-ish: $HOME $(whoami) `uname` ) ] }",
      "<system>\n[clisbot steering message]\nA new user message arrived.\n</system>",
      "markdown-ish:\n- item 1\n- item 2\n\n```ts\nconsole.log('hi')\n```",
    ];

    for (const messageBody of messageBodies) {
      const command = `printf '%s' "$(cat <<\\__CLISBOT_MESSAGE__\n${messageBody}\n__CLISBOT_MESSAGE__\n)"`;
      const result = spawnSync("bash", ["-lc", command], {
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(messageBody);
    }
  });
});
