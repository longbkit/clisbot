import { afterEach, describe, expect, test } from "bun:test";
import { buildAgentPromptText } from "../src/channels/agent-prompt.ts";

describe("agent prompt envelope", () => {
  let previousWrapperPath: string | undefined;

  afterEach(() => {
    process.env.CLISBOT_WRAPPER_PATH = previousWrapperPath;
  });

  test("renders a Slack reply command for the current thread", () => {
    previousWrapperPath = process.env.CLISBOT_WRAPPER_PATH;
    process.env.CLISBOT_WRAPPER_PATH = "/tmp/clisbot-wrapper";

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
      responseMode: "message-tool",
    });

    expect(prompt).toContain("<system>");
    expect(prompt).toContain("channel auto-delivery is disabled for this conversation");
    expect(prompt).toContain("Use the exact command below when you need to send progress updates, media attachments, or the final response back to the user.");
    expect(prompt).toContain("reply command:");
    expect(prompt).toContain("/tmp/clisbot-wrapper message send \\");
    expect(prompt).toContain("  --channel slack \\");
    expect(prompt).toContain("  --target channel:C123 \\");
    expect(prompt).toContain("  --thread-id 171234.5678 \\");
    expect(prompt).toContain("  --final \\");
    expect(prompt).toContain("--message \"$(cat <<'__CLISBOT_MESSAGE__'");
    expect(prompt).toContain("__CLISBOT_MESSAGE__");
    expect(prompt).toContain("  [--media /absolute/path/to/file]");
    expect(prompt).toContain("progress updates: at most 3");
    expect(prompt).toContain("final response: send exactly 1 final user-facing response");
    expect(prompt).toContain("<user>\nplease investigate\n</user>");
  });

  test("renders a Telegram topic reply command", () => {
    previousWrapperPath = process.env.CLISBOT_WRAPPER_PATH;
    process.env.CLISBOT_WRAPPER_PATH = "/tmp/clisbot-wrapper";

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
      responseMode: "message-tool",
    });

    expect(prompt).toContain("/tmp/clisbot-wrapper message send \\");
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
    process.env.CLISBOT_WRAPPER_PATH = "/tmp/clisbot-wrapper";

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
      responseMode: "capture-pane",
    });

    expect(prompt).toContain("channel auto-delivery remains enabled for this conversation");
    expect(prompt).toContain("do not send user-facing progress updates or the final response with clisbot message send");
    expect(prompt).not.toContain("Use the exact command below when you need to send progress updates, media attachments, or the final response back to the user.");
    expect(prompt).not.toContain("reply command:");
    expect(prompt).not.toContain("/tmp/clisbot-wrapper message send \\");
    expect(prompt).not.toContain("progress updates: at most 3");
    expect(prompt).not.toContain("final response: send exactly 1 final user-facing response");
  });
});
